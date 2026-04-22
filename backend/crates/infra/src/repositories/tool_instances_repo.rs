//! Minimal scaffold for the `tool_instances` table.
//!
//! This batch (Product Classification — Batch 2) only wires up the handful
//! of repo operations needed by other Batch-2 work:
//! - `insert` (used by future seed + test fixtures; cross-class guard in
//!   place from day one).
//! - `count_by_product` (consumed by `product_repo::class_lock_status` and
//!   `reclassify` via the shared `count_class_blockers_in_tx` helper —
//!   included here for callers that do not need the other two blocker
//!   counts).
//!
//! State-transition helpers (`check_out`, `check_in`, etc.) intentionally
//! belong to the later `tools-and-spares-flow` change (design §6d, D8).

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::ProductClass;
use vandepot_domain::models::tool_instance::ToolInstance;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct ToolInstanceRow {
    id: Uuid,
    product_id: Uuid,
    serial: String,
    status: String,
    location_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ToolInstanceRow> for ToolInstance {
    fn from(row: ToolInstanceRow) -> Self {
        ToolInstance {
            id: row.id,
            product_id: row.product_id,
            serial: row.serial,
            status: row.status,
            location_id: row.location_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Insert a new `tool_instances` row. Enforces the domain invariant that
/// only `tool_spare` products can have tool instances (the DB does not
/// express this directly — see design D9).
pub async fn insert(
    pool: &PgPool,
    product_id: Uuid,
    serial: String,
    location_id: Option<Uuid>,
) -> Result<ToolInstance, DomainError> {
    // Cross-class guard. Mismatches return `Validation` with a stable code
    // prefix so the API layer can expose it without string-matching the
    // localized message.
    let class: Option<(ProductClass,)> = sqlx::query_as(
        "SELECT product_class FROM products WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    let class = class
        .ok_or_else(|| DomainError::NotFound("Product not found".to_string()))?
        .0;
    if !matches!(class, ProductClass::ToolSpare) {
        return Err(DomainError::Validation(
            "PRODUCT_CLASS_MISMATCH: tool_instances can only reference tool_spare products"
                .to_string(),
        ));
    }

    let row = sqlx::query_as::<_, ToolInstanceRow>(
        r#"
        INSERT INTO tool_instances (product_id, serial, location_id)
        VALUES ($1, $2, $3)
        RETURNING id, product_id, serial, status, location_id, created_at, updated_at
        "#,
    )
    .bind(product_id)
    .bind(&serial)
    .bind(location_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(ToolInstance::from(row))
}

/// Count `tool_instances` referencing `product_id`. Used by
/// `class_lock_status` for one-off reads; the main `reclassify`/lock path
/// batches three counts together inside a single transaction via
/// `product_repo::count_class_blockers_in_tx`.
pub async fn count_by_product(
    conn: &mut PgConnection,
    product_id: Uuid,
) -> Result<i64, DomainError> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tool_instances WHERE product_id = $1")
        .bind(product_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    Ok(row.0)
}
