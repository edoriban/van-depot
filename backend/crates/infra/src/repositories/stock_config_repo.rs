//! Stock configuration repository — tenant-scoped free functions.
//!
//! Phase B batch 8 (multi-tenant-foundation, design Decision: stock_configuration
//! is per-tenant). Migration 20260508000009 made the table per-tenant; this
//! module now threads `tenant_id` through every read and write so two tenants
//! with the same `(warehouse_id, product_id)` key never see each other's
//! values.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N`. The composite
//! FK from B8.2 ensures (tenant_id, warehouse_id) and (tenant_id, product_id)
//! always agree at the DB layer.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct StockConfigRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
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
    pub tenant_id: Uuid,
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

const SELECT_COLUMNS: &str = "id, tenant_id, warehouse_id, product_id, \
                              default_min_stock::float8, critical_stock_multiplier::float8, \
                              low_stock_multiplier::float8, created_at, updated_at";

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_global_config(
    conn: &mut PgConnection,
    tenant_id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM stock_configuration \
         WHERE tenant_id = $1 AND warehouse_id IS NULL AND product_id IS NULL"
    );
    let row = sqlx::query_as::<_, StockConfigRow>(&sql)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    Ok(row)
}

pub async fn get_warehouse_config(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM stock_configuration \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND product_id IS NULL"
    );
    let row = sqlx::query_as::<_, StockConfigRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    Ok(row)
}

pub async fn get_product_config(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM stock_configuration \
         WHERE tenant_id = $1 AND product_id = $2 AND warehouse_id IS NULL"
    );
    let row = sqlx::query_as::<_, StockConfigRow>(&sql)
        .bind(tenant_id)
        .bind(product_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    Ok(row)
}

/// Resolve the effective stock configuration.
/// Resolution order: per-product > per-warehouse > global > hardcoded defaults.
pub async fn resolve_config(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
    warehouse_id: Uuid,
) -> Result<StockConfigRow, DomainError> {
    if let Some(config) = get_product_config(&mut *conn, tenant_id, product_id).await? {
        return Ok(config);
    }

    if let Some(config) = get_warehouse_config(&mut *conn, tenant_id, warehouse_id).await? {
        return Ok(config);
    }

    if let Some(config) = get_global_config(&mut *conn, tenant_id).await? {
        return Ok(config);
    }

    // Hardcoded defaults — fallback for tenants whose global row was never
    // provisioned (shouldn't happen post-B8.3 because tenant_repo::create
    // calls replicate_stock_config_for_tenant). Keep the safety net for the
    // "tenant created via direct SQL" edge case.
    Ok(StockConfigRow {
        id: Uuid::nil(),
        tenant_id,
        warehouse_id: None,
        product_id: None,
        default_min_stock: 10.0,
        critical_stock_multiplier: 0.5,
        low_stock_multiplier: 0.75,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

/// List product-level overrides (configs where product_id IS NOT NULL) within
/// the tenant. Joins with `products` (tenant-scoped) to include product name +
/// SKU.
pub async fn list_overrides(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<StockConfigOverrideRow>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM stock_configuration
        WHERE tenant_id = $1 AND product_id IS NOT NULL
        "#,
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let rows = sqlx::query_as::<_, StockConfigOverrideRow>(
        r#"
        SELECT sc.id, sc.tenant_id, sc.warehouse_id, sc.product_id,
               sc.default_min_stock::float8, sc.critical_stock_multiplier::float8,
               sc.low_stock_multiplier::float8, sc.created_at, sc.updated_at,
               p.name AS product_name, p.sku AS product_sku
        FROM stock_configuration sc
        LEFT JOIN products p ON p.id = sc.product_id AND p.tenant_id = sc.tenant_id
        WHERE sc.tenant_id = $1 AND sc.product_id IS NOT NULL
        ORDER BY sc.created_at DESC
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

/// Get a single stock config by ID, scoped to the active tenant. Cross-tenant
/// IDs resolve to None (caller maps to 404).
pub async fn get_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<StockConfigRow>, DomainError> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM stock_configuration \
         WHERE id = $1 AND tenant_id = $2"
    );
    let row = sqlx::query_as::<_, StockConfigRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    Ok(row)
}

/// Update a stock config by its primary key ID, scoped to the active tenant.
pub async fn update_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    default_min_stock: f64,
    critical_stock_multiplier: f64,
    low_stock_multiplier: f64,
) -> Result<StockConfigRow, DomainError> {
    let sql = format!(
        "UPDATE stock_configuration \
         SET default_min_stock = $3, \
             critical_stock_multiplier = $4, \
             low_stock_multiplier = $5 \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {SELECT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, StockConfigRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(default_min_stock)
        .bind(critical_stock_multiplier)
        .bind(low_stock_multiplier)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| DomainError::NotFound("Stock config not found".to_string()))?;
    Ok(row)
}

/// Delete a stock config by its primary key ID, scoped to the active tenant.
pub async fn delete_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "DELETE FROM stock_configuration WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Stock config not found".to_string()));
    }
    Ok(())
}

/// Upsert a stock config row scoped to a tenant. The conflict target is the
/// tenant-scoped UNIQUE NULLS NOT DISTINCT installed by B8.2, so a single
/// query handles all four shapes (global, per-warehouse, per-product,
/// specific) without separate INSERT branches.
pub async fn upsert_config(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Option<Uuid>,
    product_id: Option<Uuid>,
    default_min_stock: f64,
    critical_stock_multiplier: f64,
    low_stock_multiplier: f64,
) -> Result<StockConfigRow, DomainError> {
    let row = sqlx::query_as::<_, StockConfigRow>(
        r#"
        INSERT INTO stock_configuration
            (tenant_id, warehouse_id, product_id, default_min_stock,
             critical_stock_multiplier, low_stock_multiplier)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ON CONSTRAINT stock_configuration_tenant_warehouse_product_key
        DO UPDATE SET
            default_min_stock = $4,
            critical_stock_multiplier = $5,
            low_stock_multiplier = $6
        RETURNING id, tenant_id, warehouse_id, product_id,
                  default_min_stock::float8, critical_stock_multiplier::float8,
                  low_stock_multiplier::float8, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .bind(product_id)
    .bind(default_min_stock)
    .bind(critical_stock_multiplier)
    .bind(low_stock_multiplier)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;
    Ok(row)
}
