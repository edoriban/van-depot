//! Per-request tenant transaction wrapper.
//!
//! Phase C task C2 (multi-tenant-foundation, design §5.2): every authenticated
//! request runs inside a single Postgres transaction that owns the RLS context
//! (`SET LOCAL app.current_tenant`, `SET LOCAL app.is_superadmin`). The
//! `TenantTx` struct bundles the resolved [`TenantContext`] with that open
//! transaction so handlers can use both via a single Axum extractor (see
//! `crates/api/src/extractors/tenant.rs`).
//!
//! ## Lifecycle
//!
//! 1. `tenant_tx_middleware` (C3) verifies the caller's claims, opens
//!    `pool.begin()`, calls `set_config(...)` to plant the session vars, and
//!    stores a [`TenantTx`] in `request.extensions_mut()`.
//! 2. The `Tenant` extractor (C2) `removes` the [`TenantTx`] from extensions
//!    and hands it to the handler by value.
//! 3. The handler executes its repo calls against `&mut *tt.tx` (the
//!    transaction `Deref`s to `&mut PgConnection`).
//! 4. On success, the handler MUST call `tt.commit().await?` to land the
//!    writes. On error, dropping the [`TenantTx`] silently rolls the tx back
//!    (sqlx's `Transaction` rolls back on drop).
//!
//! This explicit-commit contract is documented at the API extractor module
//! and mirrored on every handler that takes `Tenant`.
//!
//! ## Why `'static` (and not borrowed)
//!
//! The transaction's lifetime is tied to the [`PgPool`] but Axum needs the
//! extracted value to be `Send + 'static` so handlers can `.await` across
//! `await` points. `sqlx::Transaction<'_, Postgres>` is `'static` when it
//! owns its connection (the typical pool-issued case), so we re-tag it
//! `<'static>` here.

use std::sync::{Arc, Mutex};

use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::auth::tenant_context::{TenantContext, TenantContextError};

/// Per-request bundle of resolved tenant identity + open transaction.
///
/// The transaction is owned exclusively by the handler that extracts this
/// value; only one handler per request is allowed to take ownership of the
/// tx. Cloning the wrapper is forbidden (the inner tx is not `Clone`).
pub struct TenantTx {
    pub ctx: TenantContext,
    pub tx: Transaction<'static, Postgres>,
}

impl TenantTx {
    /// Construct a new wrapper. Used only by the middleware (C3).
    pub fn new(ctx: TenantContext, tx: Transaction<'static, Postgres>) -> Self {
        Self { ctx, tx }
    }

    /// The resolved tenant context for this request.
    pub fn ctx(&self) -> &TenantContext {
        &self.ctx
    }

    /// Convenience: returns the active tenant id, or
    /// [`TenantContextError::MissingTenant`] for superadmin / intermediate
    /// tokens.
    pub fn tenant_id(&self) -> Result<Uuid, TenantContextError> {
        self.ctx.require_tenant()
    }

    /// Borrows the underlying connection. Equivalent to `&mut *self.tx`.
    /// Repos that take `&mut PgConnection` accept this directly.
    pub fn conn(&mut self) -> &mut PgConnection {
        &mut self.tx
    }

    /// Commits the request transaction. Handlers MUST call this on the
    /// success path; otherwise the tx is dropped (rolled back) silently.
    pub async fn commit(self) -> Result<(), sqlx::Error> {
        self.tx.commit().await
    }

    /// Explicit rollback. Equivalent to dropping `self`, but documents
    /// intent at the call site.
    pub async fn rollback(self) -> Result<(), sqlx::Error> {
        self.tx.rollback().await
    }
}

/// `Clone + Send + Sync` wrapper used to stash a [`TenantTx`] in Axum's
/// request extensions (which require those bounds). The actual tx is held
/// behind a `Mutex<Option<_>>` and is "moved out" by the extractor on the
/// first take — subsequent takes return `None`.
#[derive(Clone)]
pub struct TenantTxHandle {
    inner: Arc<Mutex<Option<TenantTx>>>,
}

/// Test helper: run `f` inside a transaction with `app.is_superadmin='true'`
/// so RLS policies grant the bypass. Useful for fixtures that build seed data
/// directly via SQL — without it, every INSERT under RLS-enabled tables fails.
///
/// The closure receives `&mut PgConnection` (the underlying tx connection).
/// On Ok, the tx is committed. On Err, dropped (rollback).
///
/// Phase C task C4: integration tests that bypass the API middleware (i.e.
/// poke the DB directly with `repo` calls) need this to authenticate against
/// RLS as a superadmin. HTTP-layer tests don't need this — they go through
/// the real `tenant_tx_middleware`.
pub async fn with_bypass_session<F, R>(
    pool: &sqlx::PgPool,
    f: F,
) -> Result<R, sqlx::Error>
where
    F: for<'c> AsyncFnOnce(&'c mut sqlx::PgConnection) -> Result<R, sqlx::Error>,
{
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('app.is_superadmin', 'true', true)")
        .execute(&mut *tx)
        .await?;
    let result = f(&mut tx).await?;
    tx.commit().await?;
    Ok(result)
}

impl TenantTxHandle {
    pub fn new(tt: TenantTx) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(tt))),
        }
    }

    /// Take ownership of the wrapped [`TenantTx`]. Returns `None` if a
    /// previous extraction already removed it (programmer error in the
    /// router wiring — extractors should run at most once per request).
    pub fn take(&self) -> Option<TenantTx> {
        self.inner.lock().ok().and_then(|mut g| g.take())
    }
}
