use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct StockConfigRow {
    pub id: Uuid,
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct StockConfigOverrideRow {
    pub id: Uuid,
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_global_config(
    pool: &PgPool,
) -> Result<Option<StockConfigRow>, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        SELECT id, warehouse_id, product_id,
               default_min_stock::float8, critical_stock_multiplier::float8,
               low_stock_multiplier::float8, created_at, updated_at
        FROM stock_configuration
        WHERE warehouse_id IS NULL AND product_id IS NULL
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn get_warehouse_config(
    pool: &PgPool,
    warehouse_id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        SELECT id, warehouse_id, product_id,
               default_min_stock::float8, critical_stock_multiplier::float8,
               low_stock_multiplier::float8, created_at, updated_at
        FROM stock_configuration
        WHERE warehouse_id = $1 AND product_id IS NULL
        "#,
    )
    .bind(warehouse_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn get_product_config(
    pool: &PgPool,
    product_id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        SELECT id, warehouse_id, product_id,
               default_min_stock::float8, critical_stock_multiplier::float8,
               low_stock_multiplier::float8, created_at, updated_at
        FROM stock_configuration
        WHERE product_id = $1 AND warehouse_id IS NULL
        "#,
    )
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

/// Resolve the effective stock configuration.
/// Resolution order: per-product > per-warehouse > global > hardcoded defaults.
pub async fn resolve_config(
    pool: &PgPool,
    product_id: Uuid,
    warehouse_id: Uuid,
) -> Result<StockConfigRow, DomainError> {
    // Try per-product first
    if let Some(config) = get_product_config(pool, product_id).await? {
        return Ok(config);
    }

    // Then per-warehouse
    if let Some(config) = get_warehouse_config(pool, warehouse_id).await? {
        return Ok(config);
    }

    // Then global
    if let Some(config) = get_global_config(pool).await? {
        return Ok(config);
    }

    // Hardcoded defaults
    Ok(StockConfigRow {
        id: Uuid::nil(),
        warehouse_id: None,
        product_id: None,
        default_min_stock: 10.0,
        critical_stock_multiplier: 0.5,
        low_stock_multiplier: 0.75,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

/// List product-level overrides (configs where product_id IS NOT NULL) with pagination.
/// Joins with products table to include product name and SKU.
pub async fn list_overrides(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<(Vec<StockConfigOverrideRow>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM stock_configuration
        WHERE product_id IS NOT NULL
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    let rows = sqlx::query_as::<_, StockConfigOverrideRow>(
        r#"
        SELECT sc.id, sc.warehouse_id, sc.product_id,
               sc.default_min_stock::float8, sc.critical_stock_multiplier::float8,
               sc.low_stock_multiplier::float8, sc.created_at, sc.updated_at,
               p.name AS product_name, p.sku AS product_sku
        FROM stock_configuration sc
        LEFT JOIN products p ON p.id = sc.product_id
        WHERE sc.product_id IS NOT NULL
        ORDER BY sc.created_at DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok((rows, total.0))
}

/// Get a single stock config by ID.
pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        SELECT id, warehouse_id, product_id,
               default_min_stock::float8, critical_stock_multiplier::float8,
               low_stock_multiplier::float8, created_at, updated_at
        FROM stock_configuration
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

/// Update a stock config by its primary key ID.
pub async fn update_by_id(
    pool: &PgPool,
    id: Uuid,
    default_min_stock: f64,
    critical_stock_multiplier: f64,
    low_stock_multiplier: f64,
) -> Result<StockConfigRow, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        UPDATE stock_configuration
        SET default_min_stock = $2,
            critical_stock_multiplier = $3,
            low_stock_multiplier = $4
        WHERE id = $1
        RETURNING id, warehouse_id, product_id,
                  default_min_stock::float8, critical_stock_multiplier::float8,
                  low_stock_multiplier::float8, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(default_min_stock)
    .bind(critical_stock_multiplier)
    .bind(low_stock_multiplier)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Stock config not found".to_string()))?;

    Ok(row)
}

/// Delete a stock config by its primary key ID.
pub async fn delete_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query("DELETE FROM stock_configuration WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Stock config not found".to_string()));
    }

    Ok(())
}

pub async fn upsert_config(
    pool: &PgPool,
    warehouse_id: Option<Uuid>,
    product_id: Option<Uuid>,
    default_min_stock: f64,
    critical_stock_multiplier: f64,
    low_stock_multiplier: f64,
) -> Result<StockConfigRow, DomainError> {
    // Determine the conflict target based on the combination
    let row = if product_id.is_some() && warehouse_id.is_none() {
        // Per-product config
        sqlx::query_as::<_, StockConfigRow>(
            r#"
            INSERT INTO stock_configuration
                (warehouse_id, product_id, default_min_stock,
                 critical_stock_multiplier, low_stock_multiplier)
            VALUES (NULL, $1, $2, $3, $4)
            ON CONFLICT (product_id) WHERE product_id IS NOT NULL AND warehouse_id IS NULL
            DO UPDATE SET
                default_min_stock = $2,
                critical_stock_multiplier = $3,
                low_stock_multiplier = $4
            RETURNING id, warehouse_id, product_id,
                      default_min_stock::float8, critical_stock_multiplier::float8,
                      low_stock_multiplier::float8, created_at, updated_at
            "#,
        )
        .bind(product_id)
        .bind(default_min_stock)
        .bind(critical_stock_multiplier)
        .bind(low_stock_multiplier)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else if warehouse_id.is_some() && product_id.is_none() {
        // Per-warehouse config
        sqlx::query_as::<_, StockConfigRow>(
            r#"
            INSERT INTO stock_configuration
                (warehouse_id, product_id, default_min_stock,
                 critical_stock_multiplier, low_stock_multiplier)
            VALUES ($1, NULL, $2, $3, $4)
            ON CONFLICT (warehouse_id) WHERE warehouse_id IS NOT NULL AND product_id IS NULL
            DO UPDATE SET
                default_min_stock = $2,
                critical_stock_multiplier = $3,
                low_stock_multiplier = $4
            RETURNING id, warehouse_id, product_id,
                      default_min_stock::float8, critical_stock_multiplier::float8,
                      low_stock_multiplier::float8, created_at, updated_at
            "#,
        )
        .bind(warehouse_id)
        .bind(default_min_stock)
        .bind(critical_stock_multiplier)
        .bind(low_stock_multiplier)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        // Global config (both NULL)
        sqlx::query_as::<_, StockConfigRow>(
            r#"
            INSERT INTO stock_configuration
                (warehouse_id, product_id, default_min_stock,
                 critical_stock_multiplier, low_stock_multiplier)
            VALUES (NULL, NULL, $1, $2, $3)
            ON CONFLICT ((1)) WHERE warehouse_id IS NULL AND product_id IS NULL
            DO UPDATE SET
                default_min_stock = $1,
                critical_stock_multiplier = $2,
                low_stock_multiplier = $3
            RETURNING id, warehouse_id, product_id,
                      default_min_stock::float8, critical_stock_multiplier::float8,
                      low_stock_multiplier::float8, created_at, updated_at
            "#,
        )
        .bind(default_min_stock)
        .bind(critical_stock_multiplier)
        .bind(low_stock_multiplier)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(row)
}
