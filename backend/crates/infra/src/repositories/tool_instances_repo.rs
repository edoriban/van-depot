//! Minimal scaffold for the `tool_instances` table.
//!
//! Phase B batch 8 (multi-tenant-foundation): the table now carries a
//! `tenant_id` column (migration 20260508000010) with composite FKs to both
//! parents (products, locations). Free-function shape, `&mut PgConnection`
//! first, `tenant_id: Uuid` second — same canonical signature as every
//! other tenant-scoped repo since B1.
//!
//! State-transition helpers (`check_out`, `check_in`, etc.) intentionally
//! belong to the later `tools-and-spares-flow` change (design §6d, D8).

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
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
///
/// Tenant safety: `tenant_id` is bound on the row AND the cross-class guard
/// looks up the product scoped to the same tenant. The composite FK to
/// `products(tenant_id, id)` rejects any cross-tenant product reference at
/// the DB layer; the explicit predicate is belt-and-suspenders.
pub async fn insert(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
    serial: String,
    location_id: Option<Uuid>,
) -> Result<ToolInstance, DomainError> {
    // Cross-class guard. Mismatches return `Validation` with a stable code
    // prefix so the API layer can expose it without string-matching the
    // localized message. Scope the lookup to the tenant — a product UUID
    // from another tenant will resolve to None and surface as NotFound.
    let class: Option<(ProductClass,)> = sqlx::query_as(
        "SELECT product_class FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(product_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
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
        INSERT INTO tool_instances (tenant_id, product_id, serial, location_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, product_id, serial, status, location_id, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(&serial)
    .bind(location_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(ToolInstance::from(row))
}

/// Count `tool_instances` referencing `product_id` within `tenant_id`. Used
/// by `class_lock_status` for one-off reads; the main `reclassify`/lock path
/// batches three counts together inside a single transaction via
/// `product_repo::count_class_blockers_in_tx`.
pub async fn count_by_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
) -> Result<i64, DomainError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM tool_instances \
         WHERE tenant_id = $1 AND product_id = $2",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;
    Ok(row.0)
}
