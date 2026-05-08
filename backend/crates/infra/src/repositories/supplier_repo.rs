//! Supplier repository — free functions over `&mut PgConnection`.
//!
//! Phase B batch 3 (multi-tenant-foundation, design §5.4) collapsed the
//! struct-with-pool + trait shape into free functions. Every function takes
//! `&mut PgConnection` as the first parameter and `tenant_id: Uuid` as the
//! second — the canonical signature documented in
//! `sdd/multi-tenant-foundation/apply-progress` (B1/B2 templates).
//!
//! Defense-in-depth: every query carries a `WHERE tenant_id = $N` predicate
//! even though Phase C will add Postgres RLS on top. The duplicate check
//! costs effectively nothing (the index `idx_suppliers_tenant` covers it)
//! and protects us during the window between B-end and C-land.
//!
//! Identity correctness: `update`/`delete` filter on BOTH `id` and
//! `tenant_id`. A leaked or guessed UUID belonging to another tenant
//! resolves to "row not found" rather than mutating the wrong row.
//!
//! Note: `suppliers` has NO `deleted_at` column — `delete` is a HARD delete.
//! `has_movements` is the preflight guard used by the handler before
//! attempting the destructive op (movements still references suppliers via a
//! single-column FK; B4..B6 will composite-FK that).

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::supplier::Supplier;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct SupplierRow {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<SupplierRow> for Supplier {
    fn from(row: SupplierRow) -> Self {
        Supplier {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            contact_name: row.contact_name,
            phone: row.phone,
            email: row.email,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

const SUPPLIER_COLUMNS: &str =
    "id, tenant_id, name, contact_name, phone, email, is_active, created_at, updated_at";

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Supplier>, DomainError> {
    let sql = format!(
        "SELECT {SUPPLIER_COLUMNS} FROM suppliers \
         WHERE id = $1 AND tenant_id = $2"
    );
    let row = sqlx::query_as::<_, SupplierRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Supplier::from))
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Supplier>, i64), DomainError> {
    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM suppliers WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    let sql = format!(
        "SELECT {SUPPLIER_COLUMNS} FROM suppliers \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3"
    );
    let rows: Vec<SupplierRow> = sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
    contact_name: Option<&str>,
    phone: Option<&str>,
    email: Option<&str>,
) -> Result<Supplier, DomainError> {
    let sql = format!(
        "INSERT INTO suppliers (tenant_id, name, contact_name, phone, email) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING {SUPPLIER_COLUMNS}"
    );
    let row = sqlx::query_as::<_, SupplierRow>(&sql)
        .bind(tenant_id)
        .bind(name)
        .bind(contact_name)
        .bind(phone)
        .bind(email)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Supplier::from(row))
}

pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    contact_name: Option<Option<&str>>,
    phone: Option<Option<&str>>,
    email: Option<Option<&str>>,
) -> Result<Supplier, DomainError> {
    let sql = format!(
        "UPDATE suppliers SET \
            name = COALESCE($3, name), \
            contact_name = CASE WHEN $4 THEN $5 ELSE contact_name END, \
            phone = CASE WHEN $6 THEN $7 ELSE phone END, \
            email = CASE WHEN $8 THEN $9 ELSE email END, \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {SUPPLIER_COLUMNS}"
    );
    let row = sqlx::query_as::<_, SupplierRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(name)
        .bind(contact_name.is_some())
        .bind(contact_name.flatten())
        .bind(phone.is_some())
        .bind(phone.flatten())
        .bind(email.is_some())
        .bind(email.flatten())
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Supplier::from(row))
}

pub async fn delete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result =
        sqlx::query("DELETE FROM suppliers WHERE id = $1 AND tenant_id = $2")
            .bind(id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Supplier not found".to_string()));
    }

    Ok(())
}

/// Existence check for any movement referencing this supplier within the
/// caller's tenant. The `movements` table does not yet carry tenant_id
/// (B4 territory); however, every movement references either a product or
/// a location that DOES carry tenant_id, and the supplier_id itself is
/// already tenant-anchored via this function's `tenant_id` filter. Once B4
/// lands tenant_id on movements, tighten this to a JOIN-based filter.
pub async fn has_movements(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<bool, DomainError> {
    // Tenant-scope the existence probe so a leaked id from another tenant
    // resolves to "no movements" rather than leaking blocker state. Same
    // guard pattern as `product_repo::class_lock_status` (B2).
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if exists.is_none() {
        return Err(DomainError::NotFound("Supplier not found".to_string()));
    }

    let result: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM movements WHERE supplier_id = $1)",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(result.0)
}
