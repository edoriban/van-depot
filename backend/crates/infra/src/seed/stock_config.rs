//! Per-tenant stock_configuration replication helper.
//!
//! Phase B batch 8.3 (multi-tenant-foundation, design Decision: stock_configuration
//! is per-tenant). Migration 20260508000009 made the table per-tenant; this
//! helper installs the canonical default row for a newly-created tenant.
//!
//! Behavior: idempotent INSERT of one global-per-tenant row (warehouse_id NULL +
//! product_id NULL) carrying the project's default min/multiplier values.
//! Re-runs are safe via `ON CONFLICT (tenant_id, warehouse_id, product_id) DO
//! NOTHING` — that constraint name is `stock_configuration_tenant_warehouse_product_key`
//! installed in 20260508000009.
//!
//! Default values match the original `default_min_stock`,
//! `critical_stock_multiplier`, `low_stock_multiplier` defaults from
//! `20260408000001_supplier_management.sql` so the resolution fallback in
//! `stock_config_repo::resolve_config` keeps producing the same numbers it
//! did pre-B8.

use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use crate::repositories::shared::map_sqlx_error;

/// Canonical default values for a tenant's global stock configuration. These
/// match the original column defaults from the initial schema and the
/// hardcoded fallback in `stock_config_repo::resolve_config`.
const DEFAULT_MIN_STOCK: f64 = 10.0;
const DEFAULT_CRITICAL_MULTIPLIER: f64 = 0.5;
const DEFAULT_LOW_MULTIPLIER: f64 = 0.75;

/// Creates the canonical "global default" stock_configuration row for a
/// tenant. Idempotent — calling more than once is a no-op (the unique
/// constraint on `(tenant_id, warehouse_id, product_id)` with
/// `NULLS NOT DISTINCT` ensures only one global row per tenant).
///
/// Caller is expected to invoke this inside the same transaction as the
/// tenant insert so the two rollback together if anything downstream fails.
pub async fn replicate_stock_config_for_tenant(
    conn: &mut PgConnection,
    tenant_id: Uuid,
) -> Result<(), DomainError> {
    sqlx::query(
        "INSERT INTO stock_configuration \
            (tenant_id, warehouse_id, product_id, default_min_stock, \
             critical_stock_multiplier, low_stock_multiplier) \
         VALUES ($1, NULL, NULL, $2, $3, $4) \
         ON CONFLICT ON CONSTRAINT stock_configuration_tenant_warehouse_product_key \
         DO NOTHING",
    )
    .bind(tenant_id)
    .bind(DEFAULT_MIN_STOCK)
    .bind(DEFAULT_CRITICAL_MULTIPLIER)
    .bind(DEFAULT_LOW_MULTIPLIER)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;

    /// Verifies the helper is idempotent: calling it twice for the same
    /// tenant produces exactly ONE row.
    ///
    /// This test requires a live DATABASE_URL pointing at a Postgres with
    /// migrations applied. Skipped if DATABASE_URL is unset (matches the
    /// existing pattern for repo integration tests in this crate).
    #[tokio::test]
    async fn replicate_is_idempotent() {
        let url = match std::env::var("DATABASE_URL") {
            Ok(v) => v,
            Err(_) => {
                eprintln!("skipping replicate_is_idempotent: DATABASE_URL not set");
                return;
            }
        };

        let mut conn = sqlx::PgConnection::connect(&url)
            .await
            .expect("connect to test db");

        // Use a fresh tenant inside a transaction we always roll back, so
        // the test leaves the DB unchanged.
        let mut tx = conn.begin().await.expect("begin tx");

        let tenant_id: Uuid = sqlx::query_scalar(
            "INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("test-replicate-{}", Uuid::new_v4().simple()))
        .bind("Test Replicate")
        .fetch_one(&mut *tx)
        .await
        .expect("insert tenant");

        replicate_stock_config_for_tenant(&mut tx, tenant_id)
            .await
            .expect("first replicate");
        replicate_stock_config_for_tenant(&mut tx, tenant_id)
            .await
            .expect("second replicate");

        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM stock_configuration \
             WHERE tenant_id = $1 AND warehouse_id IS NULL AND product_id IS NULL",
        )
        .bind(tenant_id)
        .fetch_one(&mut *tx)
        .await
        .expect("count stock_configuration");

        assert_eq!(count.0, 1, "expected exactly one global row per tenant");

        tx.rollback().await.expect("rollback");
    }
}
