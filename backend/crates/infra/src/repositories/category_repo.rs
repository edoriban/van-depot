//! Category repository — free functions over `&mut PgConnection`.
//!
//! See `product_repo` / `warehouse_repo` doc-comments for the canonical
//! pattern. Categories carry an additional integrity guarantee inherited
//! from the migration: the self-referential composite FK on
//! `(tenant_id, parent_id)` referencing `categories(tenant_id, id)` means a
//! child category CANNOT exist whose tenant_id differs from its parent's
//! tenant_id. Application predicates here are belt-and-suspenders; the FK
//! is the canonical enforcer.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::category::Category;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct CategoryRow {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    parent_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CategoryRow> for Category {
    fn from(row: CategoryRow) -> Self {
        Category {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            parent_id: row.parent_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

const SELECT_COLUMNS: &str = "id, tenant_id, name, parent_id, created_at, updated_at";

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Category>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM categories \
         WHERE id = $1 AND tenant_id = $2"
    );
    let row = sqlx::query_as::<_, CategoryRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Category::from))
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Category>, i64), DomainError> {
    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM categories WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM categories \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3"
    );
    let rows: Vec<CategoryRow> = sqlx::query_as(&sql)
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
    parent_id: Option<Uuid>,
) -> Result<Category, DomainError> {
    let sql = format!(
        "INSERT INTO categories (tenant_id, name, parent_id) \
         VALUES ($1, $2, $3) \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, CategoryRow>(&sql)
        .bind(tenant_id)
        .bind(name)
        .bind(parent_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Category::from(row))
}

pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    parent_id: Option<Option<Uuid>>,
) -> Result<Category, DomainError> {
    let sql = format!(
        "UPDATE categories SET \
            name = COALESCE($3, name), \
            parent_id = CASE WHEN $4 THEN $5 ELSE parent_id END, \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, CategoryRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(name)
        .bind(parent_id.is_some())
        .bind(parent_id.flatten())
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Category::from(row))
}

pub async fn delete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query("DELETE FROM categories WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Category not found".to_string()));
    }

    Ok(())
}

pub async fn has_children(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<bool, DomainError> {
    let result: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM categories \
         WHERE parent_id = $1 AND tenant_id = $2)",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(result.0)
}

pub async fn has_products(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<bool, DomainError> {
    let result: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM products \
         WHERE category_id = $1 AND tenant_id = $2 AND deleted_at IS NULL)",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(result.0)
}
