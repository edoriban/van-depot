use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::warehouse::Warehouse;
use vandepot_domain::ports::warehouse_repository::WarehouseRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
pub struct WarehouseWithStatsRow {
    pub id: Uuid,
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

pub struct PgWarehouseRepository {
    pool: PgPool,
}

impl PgWarehouseRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl PgWarehouseRepository {
    pub async fn list_with_stats(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<WarehouseWithStatsRow>, i64), DomainError> {
        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM warehouses WHERE deleted_at IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

        let rows: Vec<WarehouseWithStatsRow> = sqlx::query_as(
            r#"
            SELECT
                w.id, w.name, w.address, w.is_active,
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
            WHERE w.deleted_at IS NULL
            ORDER BY w.name
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok((rows, total.0))
    }
}

#[async_trait]
impl WarehouseRepository for PgWarehouseRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Warehouse>, DomainError> {
        let row = sqlx::query_as::<_, WarehouseRow>(
            "SELECT id, name, address, is_active, canvas_width, canvas_height, created_at, updated_at, deleted_at \
             FROM warehouses WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(row.map(Warehouse::from))
    }

    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Warehouse>, i64), DomainError> {
        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM warehouses WHERE deleted_at IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

        let rows: Vec<WarehouseRow> = sqlx::query_as(
            "SELECT id, name, address, is_active, canvas_width, canvas_height, created_at, updated_at, deleted_at \
             FROM warehouses WHERE deleted_at IS NULL \
             ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn create(&self, name: &str, address: Option<&str>) -> Result<Warehouse, DomainError> {
        // Atomic insert: the warehouse row AND its system-managed Recepción
        // location land together. If either INSERT fails, the tx rolls back
        // and no orphan warehouse survives.
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        let row = sqlx::query_as::<_, WarehouseRow>(
            "INSERT INTO warehouses (name, address) \
             VALUES ($1, $2) \
             RETURNING id, name, address, is_active, canvas_width, canvas_height, created_at, updated_at, deleted_at",
        )
        .bind(name)
        .bind(address)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Default position (0,0) and 100x100 size match the migration backfill
        // for existing warehouses; the frontend renders a "not positioned"
        // hint until the operator drags it on the canvas.
        sqlx::query(
            "INSERT INTO locations \
                (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
             VALUES ($1, 'reception', 'Recepción', 'RCP', true, 0, 0, 100, 100)",
        )
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Work-orders-and-bom (design §D4 / §D5): every warehouse ships with a
        // system-managed `finished_good` location. Migration 20260423000003
        // backfills this for pre-existing warehouses, and the seed re-runs an
        // idempotent upsert at startup — but new warehouses created through
        // this repo AFTER boot must also land in the valid state so the WO
        // complete flow can resolve an FG location without operator help.
        sqlx::query(
            "INSERT INTO locations \
                (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
             VALUES ($1, 'finished_good', 'Producto Terminado', 'PT', true, 0, 0, 100, 100)",
        )
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(Warehouse::from(row))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        address: Option<Option<&str>>,
    ) -> Result<Warehouse, DomainError> {
        let row = sqlx::query_as::<_, WarehouseRow>(
            "UPDATE warehouses SET \
                name = COALESCE($2, name), \
                address = CASE WHEN $3 THEN $4 ELSE address END, \
                updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, name, address, is_active, canvas_width, canvas_height, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(name)
        .bind(address.is_some())
        .bind(address.flatten())
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(Warehouse::from(row))
    }

    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE warehouses SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Warehouse not found".to_string()));
        }

        Ok(())
    }
}
