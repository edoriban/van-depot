//! Per-request tenant transaction middleware.
//!
//! Phase C task C3 (multi-tenant-foundation, design §5.3): authenticates the
//! request, opens a Postgres transaction, plants the RLS session vars
//! (`app.current_tenant`, `app.is_superadmin`) via `set_config(...)`, and
//! exposes a [`TenantTx`] to the downstream handler through Axum's request
//! extensions.
//!
//! ## Lifecycle contract
//!
//! 1. Decode `Claims` from the bearer token (using the existing
//!    [`Claims`] extractor).
//! 2. Resolve a [`TenantContext`] from the claims:
//!    - Superadmin: `tenant_id=None`, `is_superadmin=true`, `role=None`.
//!    - Tenant user: requires `tenant_id` AND verified `user_tenants` row
//!      (otherwise 401 / 403 — see error matrix).
//! 3. `pool.begin()` → set session vars on the tx connection → wrap into
//!    [`TenantTx`] → insert into `request.extensions_mut()`.
//! 4. Run the handler. Handlers MUST extract via the `Tenant` extractor and
//!    call `tt.commit().await?` on the success path. On error, dropping the
//!    `TenantTx` rolls back automatically (sqlx behavior on `Drop`).
//!
//! Handlers that do NOT extract `Tenant` must NOT be mounted under this
//! middleware (e.g. `/health`). If a handler "forgets" to commit, its writes
//! are silently rolled back when the request finishes — that's a fail-safe
//! default, not a feature; the convention is "always extract + always commit".
//!
//! ## Why a tx and not a connection
//!
//! `SET LOCAL` is scoped to the surrounding transaction. If we set session
//! vars on a plain pool-acquired connection (no tx), they would persist on
//! that connection across pool checkouts — a tenant-context leak. Per-tx
//! `SET LOCAL` auto-clears on COMMIT/ROLLBACK and is the only safe pattern.
//!
//! ## Error matrix (design §5.5)
//!
//! | Situation | HTTP | Notes |
//! |-----------|------|-------|
//! | Missing/invalid bearer token | 401 | from `Claims` extractor |
//! | Non-superadmin token without `tenant_id` | 401 | stale token shape |
//! | Token references non-active membership | 403 | `verify_membership` returned None |
//! | DB error (`begin`, `set_config`, `verify`) | 500 | bubbles up |
//!
//! ## Admin paths
//!
//! Admin routes (`/admin/*`) are layered with [`superadmin_guard`] AND this
//! middleware. The guard rejects non-superadmin callers with 403; this
//! middleware then opens a tx with `is_superadmin='true'` and unset
//! `current_tenant`. RLS policies allow the bypass when `is_superadmin='true'`.

use axum::{
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::{TenantContext, TenantRole};
use vandepot_infra::db::{TenantTx, TenantTxHandle};
use vandepot_infra::repositories::user_tenant_repo;

use crate::state::AppState;

/// Tower middleware that opens a per-request tenant transaction.
pub async fn tenant_tx_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();

    // 1. Authenticate. The Claims extractor already returns a 401 response
    //    on missing/invalid token.
    let claims = match Claims::from_request_parts(&mut parts, &state).await {
        Ok(c) => c,
        Err(rejection) => return rejection,
    };

    // 2. Resolve identity + verify membership. Returns 401/403/500 on its
    //    own; otherwise a fully-resolved (ctx, tenant_id_opt) pair.
    let (ctx, tenant_id_opt) = match resolve_context(&state.pool, &claims).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // 3. Open the request tx and plant RLS session vars.
    let tx = match begin_tenant_tx(&state.pool, tenant_id_opt, ctx.is_superadmin).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    // 4. Stash the wrapped tx in extensions for the handler. We use the
    //    `TenantTxHandle` wrapper because http::Extensions requires
    //    `Clone + Send + Sync`, which the bare TenantTx (owning a non-Clone
    //    transaction) cannot provide. The handle moves the inner value out
    //    on the first `take()`.
    let mut request = Request::from_parts(parts, body);
    let handle = TenantTxHandle::new(TenantTx::new(ctx, tx));
    request.extensions_mut().insert(handle);

    // 5. Run the handler. The handler is expected to extract `Tenant(tt)`
    //    and call `tt.commit().await` on the success path. If the handler
    //    forgets to extract, the tx is dropped here (silently rolled back)
    //    when the request goes out of scope — that's a fail-safe default,
    //    not a feature.
    next.run(request).await
}

/// Resolve a [`TenantContext`] from claims and verify the membership.
///
/// Returns `(ctx, Some(tenant_id))` for tenant users (which the caller plants
/// in the `app.current_tenant` session var) and `(ctx, None)` for superadmin.
async fn resolve_context(
    pool: &PgPool,
    claims: &Claims,
) -> Result<(TenantContext, Option<Uuid>), Response> {
    if claims.is_superadmin {
        // Superadmin tokens MAY carry a tenant_id (impersonation / explicit
        // scoping for testing). When present, plant `app.current_tenant` too
        // so handlers that use `tt.tenant_id()?` can read it. RLS still
        // bypasses on `app.is_superadmin='true'` regardless.
        let ctx = TenantContext {
            user_id: claims.sub,
            tenant_id: claims.tenant_id,
            is_superadmin: true,
            role: None,
        };
        return Ok((ctx, claims.tenant_id));
    }

    // Non-superadmin: tenant_id is required, and the membership must still
    // be active (defense against revoked / deleted tenants).
    let tenant_id = claims.tenant_id.ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "missing_tenant_context"})),
        )
            .into_response()
    })?;

    let mut conn = pool.acquire().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("db acquire: {e}")})),
        )
            .into_response()
    })?;

    let role: TenantRole = match user_tenant_repo::verify_membership(&mut conn, claims.sub, tenant_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": "membership_not_found_or_inactive"})),
            )
                .into_response())
        }
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("verify_membership: {e}")})),
            )
                .into_response())
        }
    };

    let ctx = TenantContext {
        user_id: claims.sub,
        tenant_id: Some(tenant_id),
        is_superadmin: false,
        role: Some(role),
    };

    Ok((ctx, Some(tenant_id)))
}

/// Open a Postgres tx and plant the RLS session vars on it.
async fn begin_tenant_tx(
    pool: &PgPool,
    tenant_id: Option<Uuid>,
    is_superadmin: bool,
) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, Response> {
    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("db begin: {e}")})),
        )
            .into_response()
    })?;

    // `set_config(name, value, is_local)` is the function form of
    // `SET LOCAL`. Unlike raw SET LOCAL it accepts bound parameters, which
    // we use for `tenant_id`. Third arg `true` means LOCAL (tx-scoped).
    if let Some(tid) = tenant_id {
        sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
            .bind(tid.to_string())
            .execute(&mut *tx)
            .await
            .map_err(set_config_err)?;
    }

    sqlx::query("SELECT set_config('app.is_superadmin', $1, true)")
        .bind(if is_superadmin { "true" } else { "false" })
        .execute(&mut *tx)
        .await
        .map_err(set_config_err)?;

    Ok(tx)
}

fn set_config_err(e: sqlx::Error) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": format!("set_config: {e}")})),
    )
        .into_response()
}
