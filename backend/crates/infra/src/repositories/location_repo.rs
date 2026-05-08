//! Location repository — free functions over `&mut PgConnection`.
//!
//! See `warehouse_repo` doc-comment for the canonical pattern. Locations
//! carry an additional integrity guarantee: the composite FK on
//! `(tenant_id, warehouse_id)` referencing `warehouses(tenant_id, id)`
//! means a location row CANNOT exist whose tenant_id differs from its
//! parent warehouse's tenant_id. Application predicates here are belt-and-
//! suspenders; the FK is the canonical enforcer.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::{DomainError, SYSTEM_LOCATION_PROTECTED};
use vandepot_domain::models::enums::LocationType;
use vandepot_domain::models::location::Location;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct LocationRow {
    id: Uuid,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    parent_id: Option<Uuid>,
    location_type: LocationType,
    name: String,
    label: Option<String>,
    is_active: bool,
    is_system: bool,
    pos_x: Option<f32>,
    pos_y: Option<f32>,
    width: Option<f32>,
    height: Option<f32>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<LocationRow> for Location {
    fn from(row: LocationRow) -> Self {
        Location {
            id: row.id,
            tenant_id: row.tenant_id,
            warehouse_id: row.warehouse_id,
            parent_id: row.parent_id,
            location_type: row.location_type,
            name: row.name,
            label: row.label,
            is_active: row.is_active,
            is_system: row.is_system,
            pos_x: row.pos_x,
            pos_y: row.pos_y,
            width: row.width,
            height: row.height,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

const SELECT_COLUMNS: &str =
    "id, tenant_id, warehouse_id, parent_id, location_type, name, label, is_active, is_system, pos_x, pos_y, width, height, created_at, updated_at";

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Location>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM locations \
         WHERE id = $1 AND tenant_id = $2"
    );
    let row = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Location::from))
}

pub async fn list_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    parent_id: Option<Uuid>,
    fetch_all: bool,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Location>, i64), DomainError> {
    if let Some(pid) = parent_id {
        // Filter by explicit parent.
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 AND parent_id = $3",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .bind(pid)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        let sql = format!(
            "SELECT {SELECT_COLUMNS} FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 AND parent_id = $3 \
             ORDER BY created_at DESC LIMIT $4 OFFSET $5"
        );
        let rows: Vec<LocationRow> = sqlx::query_as(&sql)
            .bind(tenant_id)
            .bind(warehouse_id)
            .bind(pid)
            .bind(limit)
            .bind(offset)
            .fetch_all(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

        return Ok((rows.into_iter().map(Into::into).collect(), total.0));
    }

    if fetch_all {
        // No parent filter at all.
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        let sql = format!(
            "SELECT {SELECT_COLUMNS} FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 \
             ORDER BY created_at DESC LIMIT $3 OFFSET $4"
        );
        let rows: Vec<LocationRow> = sqlx::query_as(&sql)
            .bind(tenant_id)
            .bind(warehouse_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

        return Ok((rows.into_iter().map(Into::into).collect(), total.0));
    }

    // Default: only top-level rows (parent_id IS NULL).
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND parent_id IS NULL",
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND parent_id IS NULL \
         ORDER BY created_at DESC LIMIT $3 OFFSET $4"
    );
    let rows: Vec<LocationRow> = sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
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
    warehouse_id: Uuid,
    parent_id: Option<Uuid>,
    location_type: LocationType,
    name: &str,
    label: Option<&str>,
) -> Result<Location, DomainError> {
    let sql = format!(
        "INSERT INTO locations (tenant_id, warehouse_id, parent_id, location_type, name, label) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .bind(parent_id)
        .bind(&location_type)
        .bind(name)
        .bind(label)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Location::from(row))
}

pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    label: Option<Option<&str>>,
    location_type: Option<LocationType>,
) -> Result<Location, DomainError> {
    // Preflight: scoped to tenant via `tenant_id` in the existence check.
    // System-managed rows are immutable for these three fields regardless of
    // the caller's tenant — same rule the legacy implementation enforced.
    let existing: Option<(bool,)> = sqlx::query_as(
        "SELECT is_system FROM locations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    match existing {
        None => return Err(DomainError::NotFound("Location not found".to_string())),
        Some((true,)) if name.is_some() || label.is_some() || location_type.is_some() => {
            return Err(DomainError::Conflict(format!(
                "{SYSTEM_LOCATION_PROTECTED}: cannot retype or rename system-managed location"
            )));
        }
        _ => {}
    }

    let sql = format!(
        "UPDATE locations SET \
            name = COALESCE($3, name), \
            label = CASE WHEN $4 THEN $5 ELSE label END, \
            location_type = COALESCE($6, location_type), \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(name)
        .bind(label.is_some())
        .bind(label.flatten())
        .bind(location_type)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Location::from(row))
}

pub async fn delete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let existing: Option<(bool,)> = sqlx::query_as(
        "SELECT is_system FROM locations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    match existing {
        None => return Err(DomainError::NotFound("Location not found".to_string())),
        Some((true,)) => {
            return Err(DomainError::Conflict(format!(
                "{SYSTEM_LOCATION_PROTECTED}: cannot delete system-managed location"
            )));
        }
        Some((false,)) => {}
    }

    let result = sqlx::query("DELETE FROM locations WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Location not found".to_string()));
    }

    Ok(())
}

pub async fn has_inventory(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<bool, DomainError> {
    // The location lookup itself is tenant-scoped; the inventory probe joins
    // through that scoping. (Inventory gets its own tenant_id in B4.)
    let result: (bool,) = sqlx::query_as(
        "SELECT EXISTS( \
             SELECT 1 FROM inventory i \
             JOIN locations l ON l.id = i.location_id \
             WHERE i.location_id = $1 AND l.tenant_id = $2)",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(result.0)
}

pub async fn find_reception_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Option<Location>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND location_type = 'reception' \
         LIMIT 1"
    );
    let row = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Location::from))
}

pub async fn find_finished_good_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Option<Location>, DomainError> {
    // The partial unique index `idx_one_finished_good_per_warehouse` keeps
    // this at most one row per warehouse — `LIMIT 1` is belt-and-suspenders.
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 \
           AND location_type = 'finished_good' AND is_system = true \
         LIMIT 1"
    );
    let row = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Location::from))
}

pub async fn list_work_centers_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Vec<Location>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND location_type = 'work_center' \
         ORDER BY created_at ASC"
    );
    let rows = sqlx::query_as::<_, LocationRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(rows.into_iter().map(Location::from).collect())
}

pub async fn count_work_centers_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<i64, DomainError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND location_type = 'work_center'",
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.0)
}
