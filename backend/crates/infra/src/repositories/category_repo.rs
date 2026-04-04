use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::category::Category;
use vandepot_domain::ports::category_repository::CategoryRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct CategoryRow {
    id: Uuid,
    name: String,
    parent_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CategoryRow> for Category {
    fn from(row: CategoryRow) -> Self {
        Category {
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

pub struct PgCategoryRepository {
    pool: PgPool,
}

impl PgCategoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CategoryRepository for PgCategoryRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Category>, DomainError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "SELECT id, name, parent_id, created_at, updated_at \
             FROM categories WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(row.map(Category::from))
    }

    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Category>, i64), DomainError> {
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM categories")
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        let rows: Vec<CategoryRow> = sqlx::query_as(
            "SELECT id, name, parent_id, created_at, updated_at \
             FROM categories \
             ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn create(
        &self,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Category, DomainError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "INSERT INTO categories (name, parent_id) \
             VALUES ($1, $2) \
             RETURNING id, name, parent_id, created_at, updated_at",
        )
        .bind(name)
        .bind(parent_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(Category::from(row))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        parent_id: Option<Option<Uuid>>,
    ) -> Result<Category, DomainError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "UPDATE categories SET \
                name = COALESCE($2, name), \
                parent_id = CASE WHEN $3 THEN $4 ELSE parent_id END, \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, name, parent_id, created_at, updated_at",
        )
        .bind(id)
        .bind(name)
        .bind(parent_id.is_some())
        .bind(parent_id.flatten())
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(Category::from(row))
    }

    async fn delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query("DELETE FROM categories WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Category not found".to_string()));
        }

        Ok(())
    }

    async fn has_children(&self, id: Uuid) -> Result<bool, DomainError> {
        let result: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id = $1)",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(result.0)
    }

    async fn has_products(&self, id: Uuid) -> Result<bool, DomainError> {
        let result: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM products WHERE category_id = $1 AND deleted_at IS NULL)",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(result.0)
    }
}
