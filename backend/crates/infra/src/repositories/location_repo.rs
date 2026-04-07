use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::LocationType;
use vandepot_domain::models::location::Location;
use vandepot_domain::ports::location_repository::LocationRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct LocationRow {
    id: Uuid,
    warehouse_id: Uuid,
    parent_id: Option<Uuid>,
    location_type: LocationType,
    name: String,
    label: Option<String>,
    is_active: bool,
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
            warehouse_id: row.warehouse_id,
            parent_id: row.parent_id,
            location_type: row.location_type,
            name: row.name,
            label: row.label,
            is_active: row.is_active,
            pos_x: row.pos_x,
            pos_y: row.pos_y,
            width: row.width,
            height: row.height,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

pub struct PgLocationRepository {
    pool: PgPool,
}

impl PgLocationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LocationRepository for PgLocationRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Location>, DomainError> {
        let row = sqlx::query_as::<_, LocationRow>(
            "SELECT id, warehouse_id, parent_id, location_type, name, label, is_active, pos_x, pos_y, width, height, created_at, updated_at \
             FROM locations WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(row.map(Location::from))
    }

    async fn list_by_warehouse(
        &self,
        warehouse_id: Uuid,
        parent_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Location>, i64), DomainError> {
        let (count_sql, data_sql) = if parent_id.is_some() {
            (
                "SELECT COUNT(*) FROM locations WHERE warehouse_id = $1 AND parent_id = $2",
                "SELECT id, warehouse_id, parent_id, location_type, name, label, is_active, pos_x, pos_y, width, height, created_at, updated_at \
                 FROM locations WHERE warehouse_id = $1 AND parent_id = $2 \
                 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
            )
        } else {
            (
                "SELECT COUNT(*) FROM locations WHERE warehouse_id = $1 AND parent_id IS NULL",
                "SELECT id, warehouse_id, parent_id, location_type, name, label, is_active, pos_x, pos_y, width, height, created_at, updated_at \
                 FROM locations WHERE warehouse_id = $1 AND parent_id IS NULL \
                 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            )
        };

        if let Some(pid) = parent_id {
            let total: (i64,) = sqlx::query_as(count_sql)
                .bind(warehouse_id)
                .bind(pid)
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

            let rows: Vec<LocationRow> = sqlx::query_as(data_sql)
                .bind(warehouse_id)
                .bind(pid)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

            Ok((rows.into_iter().map(Into::into).collect(), total.0))
        } else {
            let total: (i64,) = sqlx::query_as(count_sql)
                .bind(warehouse_id)
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

            let rows: Vec<LocationRow> = sqlx::query_as(data_sql)
                .bind(warehouse_id)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

            Ok((rows.into_iter().map(Into::into).collect(), total.0))
        }
    }

    async fn create(
        &self,
        warehouse_id: Uuid,
        parent_id: Option<Uuid>,
        location_type: LocationType,
        name: &str,
        label: Option<&str>,
    ) -> Result<Location, DomainError> {
        let row = sqlx::query_as::<_, LocationRow>(
            "INSERT INTO locations (warehouse_id, parent_id, location_type, name, label) \
             VALUES ($1, $2, $3, $4, $5) \
             RETURNING id, warehouse_id, parent_id, location_type, name, label, is_active, pos_x, pos_y, width, height, created_at, updated_at",
        )
        .bind(warehouse_id)
        .bind(parent_id)
        .bind(&location_type)
        .bind(name)
        .bind(label)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(Location::from(row))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        label: Option<Option<&str>>,
        location_type: Option<LocationType>,
    ) -> Result<Location, DomainError> {
        let row = sqlx::query_as::<_, LocationRow>(
            "UPDATE locations SET \
                name = COALESCE($2, name), \
                label = CASE WHEN $3 THEN $4 ELSE label END, \
                location_type = COALESCE($5, location_type), \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, warehouse_id, parent_id, location_type, name, label, is_active, pos_x, pos_y, width, height, created_at, updated_at",
        )
        .bind(id)
        .bind(name)
        .bind(label.is_some())
        .bind(label.flatten())
        .bind(location_type)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(Location::from(row))
    }

    async fn delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query("DELETE FROM locations WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Location not found".to_string()));
        }

        Ok(())
    }

    async fn has_inventory(&self, id: Uuid) -> Result<bool, DomainError> {
        let result: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM inventory WHERE location_id = $1)",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(result.0)
    }
}
