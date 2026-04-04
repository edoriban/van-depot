use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::warehouse::Warehouse;
use vandepot_domain::ports::warehouse_repository::WarehouseRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct WarehouseRow {
    id: Uuid,
    name: String,
    address: Option<String>,
    is_active: bool,
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

#[async_trait]
impl WarehouseRepository for PgWarehouseRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Warehouse>, DomainError> {
        let row = sqlx::query_as::<_, WarehouseRow>(
            "SELECT id, name, address, is_active, created_at, updated_at, deleted_at \
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
            "SELECT id, name, address, is_active, created_at, updated_at, deleted_at \
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
        let row = sqlx::query_as::<_, WarehouseRow>(
            "INSERT INTO warehouses (name, address) \
             VALUES ($1, $2) \
             RETURNING id, name, address, is_active, created_at, updated_at, deleted_at",
        )
        .bind(name)
        .bind(address)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

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
             RETURNING id, name, address, is_active, created_at, updated_at, deleted_at",
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
