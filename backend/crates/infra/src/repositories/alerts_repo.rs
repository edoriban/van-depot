use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct StockAlertRow {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub warehouse_name: String,
    pub current_quantity: f64,
    pub min_stock: f64,
    pub deficit: f64,
}

#[derive(sqlx::FromRow)]
pub struct AlertSummaryRow {
    pub critical_count: i64,
    pub low_count: i64,
    pub warning_count: i64,
    pub total_alerts: i64,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_stock_alerts(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
    warehouse_filter: Option<Uuid>,
) -> Result<Vec<StockAlertRow>, DomainError> {
    let rows = if let Some(wids) = warehouse_ids {
        // Scoped user: intersect scope with optional filter
        if let Some(wf) = warehouse_filter {
            if !wids.contains(&wf) {
                return Ok(vec![]);
            }
            sqlx::query_as::<_, StockAlertRow>(
                r#"
                SELECT i.product_id, p.name as product_name, p.sku as product_sku,
                       i.location_id, l.name as location_name, l.warehouse_id, w.name as warehouse_name,
                       i.quantity::float8 as current_quantity, p.min_stock::float8,
                       (p.min_stock - i.quantity)::float8 as deficit
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                  AND l.warehouse_id = $1
                ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
                "#,
            )
            .bind(wf)
            .fetch_all(pool)
            .await
            .map_err(map_sqlx_error)?
        } else {
            sqlx::query_as::<_, StockAlertRow>(
                r#"
                SELECT i.product_id, p.name as product_name, p.sku as product_sku,
                       i.location_id, l.name as location_name, l.warehouse_id, w.name as warehouse_name,
                       i.quantity::float8 as current_quantity, p.min_stock::float8,
                       (p.min_stock - i.quantity)::float8 as deficit
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                  AND l.warehouse_id = ANY($1)
                ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
                "#,
            )
            .bind(wids)
            .fetch_all(pool)
            .await
            .map_err(map_sqlx_error)?
        }
    } else {
        // Superadmin: sees all, with optional warehouse filter
        if let Some(wf) = warehouse_filter {
            sqlx::query_as::<_, StockAlertRow>(
                r#"
                SELECT i.product_id, p.name as product_name, p.sku as product_sku,
                       i.location_id, l.name as location_name, l.warehouse_id, w.name as warehouse_name,
                       i.quantity::float8 as current_quantity, p.min_stock::float8,
                       (p.min_stock - i.quantity)::float8 as deficit
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                  AND l.warehouse_id = $1
                ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
                "#,
            )
            .bind(wf)
            .fetch_all(pool)
            .await
            .map_err(map_sqlx_error)?
        } else {
            sqlx::query_as::<_, StockAlertRow>(
                r#"
                SELECT i.product_id, p.name as product_name, p.sku as product_sku,
                       i.location_id, l.name as location_name, l.warehouse_id, w.name as warehouse_name,
                       i.quantity::float8 as current_quantity, p.min_stock::float8,
                       (p.min_stock - i.quantity)::float8 as deficit
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
                "#,
            )
            .fetch_all(pool)
            .await
            .map_err(map_sqlx_error)?
        }
    };

    Ok(rows)
}

pub async fn get_alert_summary(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
) -> Result<AlertSummaryRow, DomainError> {
    let row = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, AlertSummaryRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE i.quantity = 0) as critical_count,
                COUNT(*) FILTER (WHERE i.quantity > 0 AND i.quantity <= p.min_stock * 0.5) as low_count,
                COUNT(*) FILTER (WHERE i.quantity > p.min_stock * 0.5 AND i.quantity <= p.min_stock) as warning_count,
                COUNT(*) as total_alerts
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            JOIN locations l ON i.location_id = l.id
            JOIN warehouses w ON l.warehouse_id = w.id
            WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
              AND p.min_stock > 0 AND i.quantity <= p.min_stock
              AND l.warehouse_id = ANY($1)
            "#,
        )
        .bind(wids)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, AlertSummaryRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE i.quantity = 0) as critical_count,
                COUNT(*) FILTER (WHERE i.quantity > 0 AND i.quantity <= p.min_stock * 0.5) as low_count,
                COUNT(*) FILTER (WHERE i.quantity > p.min_stock * 0.5 AND i.quantity <= p.min_stock) as warning_count,
                COUNT(*) as total_alerts
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            JOIN locations l ON i.location_id = l.id
            JOIN warehouses w ON l.warehouse_id = w.id
            WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
              AND p.min_stock > 0 AND i.quantity <= p.min_stock
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(row)
}
