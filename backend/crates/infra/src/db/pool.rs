//! Postgres pool initialisation.
//!
//! Phase C task C5 (multi-tenant-foundation): the pool is sized for the
//! per-request transaction model — each in-flight request holds a connection
//! for its full duration, so the pool must be at least as wide as expected
//! concurrency. We bump `max_connections` to 25 and install an `after_connect`
//! hook that sets two timeouts on every fresh connection:
//!
//! * `statement_timeout = '30s'` — caps any single statement so a slow query
//!   inside the request transaction can't tie a pool slot up indefinitely.
//! * `idle_in_transaction_session_timeout = '60s'` — kills a connection that
//!   stays inside an open tx without making progress (the tx-middleware
//!   contract guarantees this, but defense-in-depth in case a panic skips
//!   the commit/rollback path).
//!
//! Both timeouts are GUC settings; setting them per-connection makes them
//! survive `SET LOCAL` resets inside request transactions. They apply to the
//! whole session, not the tx.
//!
//! Source: design §13 ("Risks / Mitigations" — pool sizing + statement_timeout).
//!
//! ## Phase C polish — two-pool boot
//!
//! [`create_pool`] is role-agnostic: the connection role is whatever the
//! `database_url` carries. The API binary builds TWO pools at boot:
//!
//! 1. A short-lived **migrations pool** using `DATABASE_URL` (superuser
//!    `vandepot`) to run `sqlx::migrate!` and the seed helpers. Dropped after
//!    seeds.
//! 2. A long-lived **app pool** using `DATABASE_URL_APP` (non-superuser
//!    `vandepot_app`) for serving requests. Because the runtime role is not a
//!    superuser, RLS `FORCE ROW LEVEL SECURITY` actually binds it.
//!
//! Migration `20260509000002_create_app_role.sql` provisions `vandepot_app`.

use anyhow::{Context, Result};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Executor;
use tracing::info;

/// Creates a PostgreSQL connection pool with the standard `after_connect` hook.
///
/// Role-agnostic: the connection role is determined by the `database_url`. Use
/// the migrations URL (superuser) for boot-time migrations + seed; use the app
/// URL (non-superuser) for serving traffic so RLS fires.
///
/// Does NOT run migrations — call [`run_migrations`] separately on the
/// migrations pool only.
pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(25)
        .min_connections(2)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                // Cap any single statement at 30s so a runaway query inside
                // the per-request tx (Phase C) cannot tie a pool slot up.
                conn.execute("SET statement_timeout = '30s'").await?;
                // Kill connections that idle inside an open transaction.
                // Belt-and-suspenders for the tx-middleware contract.
                conn.execute("SET idle_in_transaction_session_timeout = '60s'")
                    .await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await
        .context("failed to connect to PostgreSQL")?;

    info!("connected to PostgreSQL (max_connections=25, statement_timeout=30s, idle_in_transaction_session_timeout=60s)");

    Ok(pool)
}

/// Runs every pending migration against the given pool.
///
/// Must be invoked on a pool whose connection role can perform DDL — in our
/// case that's the superuser pool (`DATABASE_URL`). The non-superuser app
/// pool (`DATABASE_URL_APP`) is read/write only and should NOT run migrations.
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("../../migrations")
        .run(pool)
        .await
        .context("failed to run database migrations")?;

    info!("database migrations applied");

    Ok(())
}
