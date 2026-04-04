use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::UnitType;
use vandepot_domain::models::product::Product;
use vandepot_domain::ports::product_repository::ProductRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct ProductRow {
    id: Uuid,
    name: String,
    sku: String,
    description: Option<String>,
    category_id: Option<Uuid>,
    unit_of_measure: UnitType,
    min_stock: f64,
    max_stock: Option<f64>,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl From<ProductRow> for Product {
    fn from(row: ProductRow) -> Self {
        Product {
            id: row.id,
            name: row.name,
            sku: row.sku,
            description: row.description,
            category_id: row.category_id,
            unit_of_measure: row.unit_of_measure,
            min_stock: row.min_stock,
            max_stock: row.max_stock,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

pub struct PgProductRepository {
    pool: PgPool,
}

impl PgProductRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const PRODUCT_COLUMNS: &str = "id, name, sku, description, category_id, unit_of_measure, \
                                min_stock::float8, max_stock::float8, is_active, created_at, updated_at, deleted_at";

#[async_trait]
impl ProductRepository for PgProductRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Product>, DomainError> {
        let sql = format!(
            "SELECT {} FROM products WHERE id = $1 AND deleted_at IS NULL",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(Product::from))
    }

    async fn list(
        &self,
        search: Option<&str>,
        category_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Product>, i64), DomainError> {
        let search_pattern = search.map(|s| format!("%{}%", s));

        // Build WHERE clauses with sequential param indices starting at $1
        let mut where_clauses = vec!["deleted_at IS NULL".to_string()];
        let mut idx: usize = 0;

        if search_pattern.is_some() {
            idx += 1;
            where_clauses.push(format!("(name ILIKE ${idx} OR sku ILIKE ${idx})"));
        }
        if category_id.is_some() {
            idx += 1;
            where_clauses.push(format!("category_id = ${idx}"));
        }

        let where_sql = where_clauses.join(" AND ");

        // Count query (same params minus LIMIT/OFFSET)
        let count_sql = format!("SELECT COUNT(*) FROM products WHERE {where_sql}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        if let Some(ref pat) = search_pattern {
            count_query = count_query.bind(pat);
        }
        if let Some(cid) = category_id {
            count_query = count_query.bind(cid);
        }
        let total = count_query
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        // Data query with LIMIT/OFFSET
        idx += 1;
        let limit_idx = idx;
        idx += 1;
        let offset_idx = idx;

        let data_sql = format!(
            "SELECT {PRODUCT_COLUMNS} FROM products WHERE {where_sql} ORDER BY created_at DESC LIMIT ${limit_idx} OFFSET ${offset_idx}"
        );
        let mut data_query = sqlx::query_as::<_, ProductRow>(&data_sql);
        if let Some(ref pat) = search_pattern {
            data_query = data_query.bind(pat);
        }
        if let Some(cid) = category_id {
            data_query = data_query.bind(cid);
        }
        data_query = data_query.bind(limit).bind(offset);

        let rows = data_query
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn create(
        &self,
        name: &str,
        sku: &str,
        description: Option<&str>,
        category_id: Option<Uuid>,
        unit_of_measure: UnitType,
        min_stock: f64,
        max_stock: Option<f64>,
    ) -> Result<Product, DomainError> {
        let sql = format!(
            "INSERT INTO products (name, sku, description, category_id, unit_of_measure, min_stock, max_stock) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) \
             RETURNING {}",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(name)
            .bind(sku)
            .bind(description)
            .bind(category_id)
            .bind(&unit_of_measure)
            .bind(min_stock)
            .bind(max_stock)
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Product::from(row))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        sku: Option<&str>,
        description: Option<Option<&str>>,
        category_id: Option<Option<Uuid>>,
        unit_of_measure: Option<UnitType>,
        min_stock: Option<f64>,
        max_stock: Option<Option<f64>>,
    ) -> Result<Product, DomainError> {
        let sql = format!(
            "UPDATE products SET \
                name = COALESCE($2, name), \
                sku = COALESCE($3, sku), \
                description = CASE WHEN $4 THEN $5 ELSE description END, \
                category_id = CASE WHEN $6 THEN $7 ELSE category_id END, \
                unit_of_measure = COALESCE($8, unit_of_measure), \
                min_stock = COALESCE($9, min_stock), \
                max_stock = CASE WHEN $10 THEN $11 ELSE max_stock END, \
                updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING {}",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(id)
            .bind(name)
            .bind(sku)
            .bind(description.is_some())
            .bind(description.flatten())
            .bind(category_id.is_some())
            .bind(category_id.flatten())
            .bind(unit_of_measure)
            .bind(min_stock)
            .bind(max_stock.is_some())
            .bind(max_stock.flatten())
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Product::from(row))
    }

    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Product not found".to_string()));
        }

        Ok(())
    }
}
