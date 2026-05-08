//! User-warehouse junction repository — free functions.
//!
//! Phase B batch 8.4 (multi-tenant-foundation, design §5.4) extracts the
//! `user_warehouses` data-access surface from `user_repo` (where it had
//! historically lived because it predates the multi-tenant work). After B8.1
//! the table carries a `tenant_id` column and a composite FK to
//! `user_tenants(tenant_id, user_id)` enforcing membership at the DB level.
//!
//! Canonical signature: every function takes `&mut PgConnection` first and
//! `tenant_id: Uuid` second. Defense-in-depth: every query carries
//! `WHERE tenant_id = $1` even though Phase C will add Postgres RLS.
//!
//! Error mapping for `assign`:
//! - The composite FK `user_warehouses_user_tenant_fk` (tenant_id, user_id)
//!   targets `user_tenants(tenant_id, user_id) UNIQUE`. If the user is not
//!   a member of the tenant the INSERT fails with Postgres SQLSTATE 23503
//!   (foreign_key_violation). We intercept that specific case and surface
//!   it as `DomainError::Validation("user is not a member of this tenant")`
//!   so the API layer can emit a 422 with a clear message.

use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

/// Idempotent assignment. Returns `Ok(())` even if the row already exists
/// (`ON CONFLICT DO NOTHING` on the PK).
///
/// Returns `DomainError::Validation("user is not a member of this tenant")`
/// when the composite FK to `user_tenants` rejects the row — the user must
/// be granted membership before they can be assigned a warehouse in that
/// tenant. Returns `DomainError::Validation` for other 23503 violations
/// (cross-tenant warehouse_id) too — the message identifies which constraint
/// fired.
pub async fn assign(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
    warehouse_id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (tenant_id, user_id, warehouse_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(warehouse_id)
    .execute(&mut *conn)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(err) => Err(map_assign_error(err)),
    }
}

fn map_assign_error(err: sqlx::Error) -> DomainError {
    if let sqlx::Error::Database(db_err) = &err {
        if db_err.code().as_deref() == Some("23503") {
            // Inspect the constraint name to give a precise message.
            let constraint = db_err.constraint().unwrap_or("");
            return match constraint {
                "user_warehouses_user_tenant_fk" => DomainError::Validation(
                    "user is not a member of this tenant".to_string(),
                ),
                "user_warehouses_warehouse_tenant_fk" => DomainError::Validation(
                    "warehouse does not belong to this tenant".to_string(),
                ),
                _ => DomainError::Validation(format!(
                    "user_warehouses FK violation: {}",
                    db_err.message()
                )),
            };
        }
    }
    map_sqlx_error(err)
}

/// Removes a (tenant_id, user_id, warehouse_id) row. Returns
/// `DomainError::NotFound` when no row matched (so the API layer can return
/// 404 — same shape as the legacy `revoke_warehouse`).
pub async fn revoke(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
    warehouse_id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "DELETE FROM user_warehouses \
         WHERE tenant_id = $1 AND user_id = $2 AND warehouse_id = $3",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(warehouse_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound(
            "Warehouse assignment not found".to_string(),
        ));
    }
    Ok(())
}

/// Lists the warehouse_ids assigned to `user_id` within `tenant_id`.
pub async fn list_for_user(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<Uuid>, DomainError> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT warehouse_id FROM user_warehouses \
         WHERE tenant_id = $1 AND user_id = $2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(ids)
}

/// Lists the user_ids assigned to `warehouse_id` within `tenant_id`.
pub async fn list_for_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Vec<Uuid>, DomainError> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM user_warehouses \
         WHERE tenant_id = $1 AND warehouse_id = $2",
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(ids)
}

/// Returns true iff `user_id` is assigned to `warehouse_id` within
/// `tenant_id`.
pub async fn is_assigned(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
    warehouse_id: Uuid,
) -> Result<bool, DomainError> {
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM user_warehouses \
         WHERE tenant_id = $1 AND user_id = $2 AND warehouse_id = $3",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(warehouse_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(exists.is_some())
}
