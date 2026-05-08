//! Warehouse repository — free functions over `&mut PgConnection`.
//!
//! Phase B batch 1 (multi-tenant-foundation, design §5.4) collapsed the
//! struct-with-pool + trait shape into free functions. Every function takes
//! `&mut PgConnection` as the first parameter and `tenant_id: Uuid` as the
//! second — the canonical signature documented in
//! `sdd/multi-tenant-foundation/apply-progress` and replicated by B2..B8.
//!
//! Defense-in-depth: every query carries a `WHERE tenant_id = $N` predicate
//! even though Phase C will add Postgres RLS on top. The duplicate check
//! costs effectively nothing (the index `idx_warehouses_tenant` covers it)
//! and protects us during the window between B-end and C-land.
//!
//! Identity correctness: `update`/`soft_delete` filter on BOTH `id` and
//! `tenant_id`. A leaked or guessed UUID belonging to another tenant
//! resolves to "row not found" rather than mutating the wrong row.

use chrono::{DateTime, Utc};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::warehouse::Warehouse;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
pub struct WarehouseWithStatsRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub is_active: bool,
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub locations_count: i64,
    pub products_count: i64,
    pub total_quantity: f64,
    pub low_stock_count: i64,
    pub critical_count: i64,
    pub last_movement_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct WarehouseRow {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    address: Option<String>,
    is_active: bool,
    canvas_width: Option<f32>,
    canvas_height: Option<f32>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl From<WarehouseRow> for Warehouse {
    fn from(row: WarehouseRow) -> Self {
        Warehouse {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            address: row.address,
            is_active: row.is_active,
            canvas_width: row.canvas_width,
            canvas_height: row.canvas_height,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

const SELECT_COLUMNS: &str =
    "id, tenant_id, name, address, is_active, canvas_width, canvas_height, created_at, updated_at, deleted_at";

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Warehouse>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM warehouses \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL"
    );
    let row = sqlx::query_as::<_, WarehouseRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Warehouse::from))
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Warehouse>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM warehouses \
         WHERE tenant_id = $1 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM warehouses \
         WHERE tenant_id = $1 AND deleted_at IS NULL \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3"
    );
    let rows: Vec<WarehouseRow> = sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn list_with_stats(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<WarehouseWithStatsRow>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM warehouses \
         WHERE tenant_id = $1 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let rows: Vec<WarehouseWithStatsRow> = sqlx::query_as(
        r#"
        SELECT
            w.id, w.tenant_id, w.name, w.address, w.is_active,
            w.canvas_width, w.canvas_height,
            w.created_at, w.updated_at,
            COALESCE(loc.cnt, 0) AS locations_count,
            COALESCE(inv.product_cnt, 0) AS products_count,
            COALESCE(inv.total_qty, 0.0) AS total_quantity,
            COALESCE(inv.low_cnt, 0) AS low_stock_count,
            COALESCE(inv.critical_cnt, 0) AS critical_count,
            mov.last_at AS last_movement_at
        FROM warehouses w
        LEFT JOIN (
            SELECT warehouse_id, COUNT(*) AS cnt
            FROM locations
            WHERE parent_id IS NULL
            GROUP BY warehouse_id
        ) loc ON loc.warehouse_id = w.id
        LEFT JOIN (
            SELECT l.warehouse_id,
                   COUNT(DISTINCT i.product_id) AS product_cnt,
                   COALESCE(SUM(i.quantity), 0)::float8 AS total_qty,
                   COUNT(*) FILTER (WHERE i.quantity <= p.min_stock AND i.quantity > 0 AND p.min_stock > 0) AS low_cnt,
                   COUNT(*) FILTER (WHERE i.quantity <= 0) AS critical_cnt
            FROM inventory i
            JOIN locations l ON l.id = i.location_id
            JOIN products p ON p.id = i.product_id
            GROUP BY l.warehouse_id
        ) inv ON inv.warehouse_id = w.id
        LEFT JOIN (
            SELECT l.warehouse_id, MAX(m.created_at) AS last_at
            FROM movements m
            JOIN locations l ON l.id = COALESCE(m.to_location_id, m.from_location_id)
            GROUP BY l.warehouse_id
        ) mov ON mov.warehouse_id = w.id
        WHERE w.tenant_id = $1 AND w.deleted_at IS NULL
        ORDER BY w.name
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok((rows, total.0))
}

/// Atomically inserts a warehouse AND its system-managed `reception` and
/// `finished_good` locations. The whole operation runs inside a sqlx
/// transaction owned by this function so a partial failure rolls back
/// cleanly. Phase C will fold this into the per-request transaction; for
/// Phase B we keep the local tx because the caller passes a plain
/// connection.
pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
    address: Option<&str>,
) -> Result<Warehouse, DomainError> {
    let mut tx = conn.begin().await.map_err(map_sqlx_error)?;

    let insert_sql = format!(
        "INSERT INTO warehouses (tenant_id, name, address) \
         VALUES ($1, $2, $3) \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, WarehouseRow>(&insert_sql)
        .bind(tenant_id)
        .bind(name)
        .bind(address)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

    // System-managed Recepción row (see initial_schema migration / design §D5
    // for context). The composite FK on locations(tenant_id, warehouse_id)
    // means we MUST bind tenant_id explicitly — leaving it NULL would fail
    // the `tenant_id NOT NULL` check.
    sqlx::query(
        "INSERT INTO locations \
            (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
         VALUES ($1, $2, 'reception', 'Recepción', 'RCP', true, 0, 0, 100, 100)",
    )
    .bind(tenant_id)
    .bind(row.id)
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    sqlx::query(
        "INSERT INTO locations \
            (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
         VALUES ($1, $2, 'finished_good', 'Producto Terminado', 'PT', true, 0, 0, 100, 100)",
    )
    .bind(tenant_id)
    .bind(row.id)
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    tx.commit().await.map_err(map_sqlx_error)?;

    Ok(Warehouse::from(row))
}

pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    address: Option<Option<&str>>,
) -> Result<Warehouse, DomainError> {
    let sql = format!(
        "UPDATE warehouses SET \
            name = COALESCE($3, name), \
            address = CASE WHEN $4 THEN $5 ELSE address END, \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, WarehouseRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(name)
        .bind(address.is_some())
        .bind(address.flatten())
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Warehouse::from(row))
}

pub async fn soft_delete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "UPDATE warehouses SET deleted_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Warehouse not found".to_string()));
    }

    Ok(())
}
