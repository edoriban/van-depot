//! Supplier-product junction-table repository — free functions over
//! `&mut PgConnection`.
//!
//! Phase B batch 3 (multi-tenant-foundation, design §5.4) added `tenant_id`
//! and switched from `&PgPool` to `&mut PgConnection + tenant_id: Uuid`. The
//! migration installs composite FKs:
//!   * `(tenant_id, supplier_id) → suppliers(tenant_id, id)`
//!   * `(tenant_id, product_id)  → products (tenant_id, id)`
//! Both ON DELETE CASCADE. The composite FKs guarantee a junction row can
//! NEVER bind a supplier and a product from different tenants — the DB will
//! reject any such INSERT/UPDATE with a 23503 (FK violation).
//!
//! Application predicates here are belt-and-suspenders. The `tenant_id =
//! $N` filter in every query is the duplicate of the FK guarantee.
//!
//! Defense-in-depth note (B3 gotcha for B6/B7): when the handler sees a
//! 23503 from one of the composite FKs, it surfaces as
//! `DomainError::Conflict("Cannot delete: referenced by other records")`
//! per `shared::map_sqlx_error`. The wording is misleading on
//! INSERT/UPDATE — see B2 apply-progress for the open follow-up to
//! distinguish operation type in the mapper.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct SupplierProductRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub supplier_id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct SupplierProductWithSupplierRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_name: String,
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Queries ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create_supplier_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    supplier_id: Uuid,
    product_id: Uuid,
    supplier_sku: Option<&str>,
    unit_cost: f64,
    lead_time_days: i32,
    minimum_order_qty: f64,
    is_preferred: bool,
) -> Result<SupplierProductRow, DomainError> {
    // The composite FKs `(tenant_id, supplier_id) → suppliers` and
    // `(tenant_id, product_id) → products` enforce that BOTH parents
    // belong to the caller's tenant. A cross-tenant supplier_id or
    // product_id surfaces as a 23503 → 409 Conflict.
    let row = sqlx::query_as::<_, SupplierProductRow>(
        r#"
        WITH inserted AS (
            INSERT INTO supplier_products
                (tenant_id, supplier_id, product_id, supplier_sku, unit_cost,
                 lead_time_days, minimum_order_qty, is_preferred)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        )
        SELECT i.id, i.tenant_id, i.supplier_id, i.product_id,
               p.name AS product_name, p.sku AS product_sku,
               i.supplier_sku, i.unit_cost::float8, i.lead_time_days,
               i.minimum_order_qty::float8, i.is_preferred, i.is_active,
               i.created_at, i.updated_at
        FROM inserted i
        JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id
        "#,
    )
    .bind(tenant_id)
    .bind(supplier_id)
    .bind(product_id)
    .bind(supplier_sku)
    .bind(unit_cost)
    .bind(lead_time_days)
    .bind(minimum_order_qty)
    .bind(is_preferred)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn list_by_supplier(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    supplier_id: Uuid,
) -> Result<Vec<SupplierProductRow>, DomainError> {
    let rows = sqlx::query_as::<_, SupplierProductRow>(
        r#"
        SELECT sp.id, sp.tenant_id, sp.supplier_id, sp.product_id,
               p.name AS product_name, p.sku AS product_sku,
               sp.supplier_sku, sp.unit_cost::float8, sp.lead_time_days,
               sp.minimum_order_qty::float8, sp.is_preferred, sp.is_active,
               sp.created_at, sp.updated_at
        FROM supplier_products sp
        JOIN products p ON sp.product_id = p.id AND p.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1
          AND sp.supplier_id = $2
          AND p.deleted_at IS NULL
        ORDER BY p.name ASC
        "#,
    )
    .bind(tenant_id)
    .bind(supplier_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

pub async fn list_by_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
) -> Result<Vec<SupplierProductWithSupplierRow>, DomainError> {
    let rows = sqlx::query_as::<_, SupplierProductWithSupplierRow>(
        r#"
        SELECT sp.id, sp.tenant_id, sp.supplier_id, s.name AS supplier_name,
               sp.product_id, sp.supplier_sku, sp.unit_cost::float8,
               sp.lead_time_days, sp.minimum_order_qty::float8,
               sp.is_preferred, sp.is_active,
               sp.created_at, sp.updated_at
        FROM supplier_products sp
        JOIN suppliers s ON sp.supplier_id = s.id AND s.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1
          AND sp.product_id = $2
          AND s.is_active = true
        ORDER BY sp.is_preferred DESC, sp.unit_cost ASC
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_supplier_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    supplier_sku: Option<Option<&str>>,
    unit_cost: Option<f64>,
    lead_time_days: Option<i32>,
    minimum_order_qty: Option<f64>,
    is_preferred: Option<bool>,
    is_active: Option<bool>,
) -> Result<SupplierProductRow, DomainError> {
    // tenant_id and the join's `p.tenant_id = u.tenant_id` predicate are
    // belt-and-suspenders for the composite FK that already enforces
    // cross-tenant integrity.
    let row = sqlx::query_as::<_, SupplierProductRow>(
        r#"
        WITH updated AS (
            UPDATE supplier_products SET
                supplier_sku = COALESCE($3, supplier_sku),
                unit_cost = COALESCE($4, unit_cost),
                lead_time_days = COALESCE($5, lead_time_days),
                minimum_order_qty = COALESCE($6, minimum_order_qty),
                is_preferred = COALESCE($7, is_preferred),
                is_active = COALESCE($8, is_active)
            WHERE id = $1 AND tenant_id = $2
            RETURNING *
        )
        SELECT u.id, u.tenant_id, u.supplier_id, u.product_id,
               p.name AS product_name, p.sku AS product_sku,
               u.supplier_sku, u.unit_cost::float8, u.lead_time_days,
               u.minimum_order_qty::float8, u.is_preferred, u.is_active,
               u.created_at, u.updated_at
        FROM updated u
        JOIN products p ON u.product_id = p.id AND p.tenant_id = u.tenant_id
        "#,
    )
    .bind(id)
    .bind(tenant_id)
    .bind(supplier_sku.flatten())
    .bind(unit_cost)
    .bind(lead_time_days)
    .bind(minimum_order_qty)
    .bind(is_preferred)
    .bind(is_active)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn delete_supplier_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result =
        sqlx::query("DELETE FROM supplier_products WHERE id = $1 AND tenant_id = $2")
            .bind(id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound(
            "Supplier product not found".to_string(),
        ));
    }

    Ok(())
}
