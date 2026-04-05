use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct DashboardStats {
    pub total_products: i64,
    pub total_warehouses: i64,
    pub total_locations: i64,
    pub total_stock_items: i64,
    pub low_stock_count: i64,
    pub movements_today: i64,
    pub movements_this_week: i64,
}

#[derive(sqlx::FromRow)]
pub struct RecentMovementRow {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub from_location_id: Option<Uuid>,
    pub from_location_name: Option<String>,
    pub to_location_id: Option<Uuid>,
    pub to_location_name: Option<String>,
    pub quantity: f64,
    pub movement_type: String,
    pub user_id: Uuid,
    pub user_name: String,
    pub reference: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct LowStockRow {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub quantity: f64,
    pub min_stock: f64,
}

#[derive(sqlx::FromRow)]
pub struct MovementsSummaryRow {
    pub entries_count: i64,
    pub exits_count: i64,
    pub transfers_count: i64,
    pub adjustments_count: i64,
    pub entries_quantity: f64,
    pub exits_quantity: f64,
}

#[derive(sqlx::FromRow)]
pub struct StockByCategoryRow {
    pub category_id: Uuid,
    pub category_name: String,
    pub total_quantity: f64,
    pub product_count: i64,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_dashboard_stats(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
) -> Result<DashboardStats, DomainError> {
    // When warehouse_ids is None, superadmin sees all.
    // When Some, scope to those warehouses.
    let row = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, DashboardStats>(
            r#"
            SELECT
                (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) as total_products,
                (SELECT COUNT(*) FROM warehouses WHERE deleted_at IS NULL AND id = ANY($1)) as total_warehouses,
                (SELECT COUNT(*) FROM locations WHERE is_active = true AND warehouse_id = ANY($1)) as total_locations,
                (SELECT COUNT(*) FROM inventory i
                    JOIN locations l ON i.location_id = l.id
                    WHERE i.quantity > 0 AND l.warehouse_id = ANY($1)) as total_stock_items,
                (SELECT COUNT(*) FROM inventory i
                    JOIN products p ON i.product_id = p.id
                    JOIN locations l ON i.location_id = l.id
                    WHERE i.quantity <= p.min_stock AND p.min_stock > 0
                    AND p.deleted_at IS NULL AND l.warehouse_id = ANY($1)) as low_stock_count,
                (SELECT COUNT(*) FROM movements m
                    LEFT JOIN locations fl ON m.from_location_id = fl.id
                    LEFT JOIN locations tl ON m.to_location_id = tl.id
                    WHERE m.created_at >= CURRENT_DATE
                    AND (fl.warehouse_id = ANY($1) OR tl.warehouse_id = ANY($1))) as movements_today,
                (SELECT COUNT(*) FROM movements m
                    LEFT JOIN locations fl ON m.from_location_id = fl.id
                    LEFT JOIN locations tl ON m.to_location_id = tl.id
                    WHERE m.created_at >= CURRENT_DATE - INTERVAL '7 days'
                    AND (fl.warehouse_id = ANY($1) OR tl.warehouse_id = ANY($1))) as movements_this_week
            "#,
        )
        .bind(wids)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, DashboardStats>(
            r#"
            SELECT
                (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) as total_products,
                (SELECT COUNT(*) FROM warehouses WHERE deleted_at IS NULL) as total_warehouses,
                (SELECT COUNT(*) FROM locations WHERE is_active = true) as total_locations,
                (SELECT COUNT(*) FROM inventory WHERE quantity > 0) as total_stock_items,
                (SELECT COUNT(*) FROM inventory i
                    JOIN products p ON i.product_id = p.id
                    WHERE i.quantity <= p.min_stock AND p.min_stock > 0
                    AND p.deleted_at IS NULL) as low_stock_count,
                (SELECT COUNT(*) FROM movements WHERE created_at >= CURRENT_DATE) as movements_today,
                (SELECT COUNT(*) FROM movements WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as movements_this_week
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(row)
}

pub async fn get_recent_movements(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
) -> Result<Vec<RecentMovementRow>, DomainError> {
    let rows = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, RecentMovementRow>(
            r#"
            SELECT m.id, m.product_id, p.name as product_name, p.sku as product_sku,
                   m.from_location_id, fl.name as from_location_name,
                   m.to_location_id, tl.name as to_location_name,
                   m.quantity::float8, m.movement_type::text, m.user_id, u.name as user_name,
                   m.reference, m.created_at
            FROM movements m
            JOIN products p ON m.product_id = p.id
            LEFT JOIN locations fl ON m.from_location_id = fl.id
            LEFT JOIN locations tl ON m.to_location_id = tl.id
            JOIN users u ON m.user_id = u.id
            WHERE fl.warehouse_id = ANY($1) OR tl.warehouse_id = ANY($1)
            ORDER BY m.created_at DESC
            LIMIT 10
            "#,
        )
        .bind(wids)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, RecentMovementRow>(
            r#"
            SELECT m.id, m.product_id, p.name as product_name, p.sku as product_sku,
                   m.from_location_id, fl.name as from_location_name,
                   m.to_location_id, tl.name as to_location_name,
                   m.quantity::float8, m.movement_type::text, m.user_id, u.name as user_name,
                   m.reference, m.created_at
            FROM movements m
            JOIN products p ON m.product_id = p.id
            LEFT JOIN locations fl ON m.from_location_id = fl.id
            LEFT JOIN locations tl ON m.to_location_id = tl.id
            JOIN users u ON m.user_id = u.id
            ORDER BY m.created_at DESC
            LIMIT 10
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(rows)
}

pub async fn get_low_stock(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<LowStockRow>, i64), DomainError> {
    let (rows, total) = if let Some(wids) = warehouse_ids {
        let rows = sqlx::query_as::<_, LowStockRow>(
            r#"
            SELECT p.id as product_id, p.name as product_name, p.sku as product_sku,
                   l.id as location_id, l.name as location_name, l.warehouse_id,
                   i.quantity::float8, p.min_stock::float8
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            JOIN locations l ON i.location_id = l.id
            WHERE i.quantity <= p.min_stock AND p.min_stock > 0
            AND p.deleted_at IS NULL AND l.warehouse_id = ANY($1)
            ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(wids)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?;

        let total: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            JOIN locations l ON i.location_id = l.id
            WHERE i.quantity <= p.min_stock AND p.min_stock > 0
            AND p.deleted_at IS NULL AND l.warehouse_id = ANY($1)
            "#,
        )
        .bind(wids)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?;

        (rows, total.0)
    } else {
        let rows = sqlx::query_as::<_, LowStockRow>(
            r#"
            SELECT p.id as product_id, p.name as product_name, p.sku as product_sku,
                   l.id as location_id, l.name as location_name, l.warehouse_id,
                   i.quantity::float8, p.min_stock::float8
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            JOIN locations l ON i.location_id = l.id
            WHERE i.quantity <= p.min_stock AND p.min_stock > 0
            AND p.deleted_at IS NULL
            ORDER BY (i.quantity / NULLIF(p.min_stock, 0)) ASC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?;

        let total: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.quantity <= p.min_stock AND p.min_stock > 0
            AND p.deleted_at IS NULL
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?;

        (rows, total.0)
    };

    Ok((rows, total))
}

pub async fn get_movements_summary(
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    warehouse_id: Option<Uuid>,
) -> Result<MovementsSummaryRow, DomainError> {
    let row = if let Some(wid) = warehouse_id {
        sqlx::query_as::<_, MovementsSummaryRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE m.movement_type = 'entry') as entries_count,
                COUNT(*) FILTER (WHERE m.movement_type = 'exit') as exits_count,
                COUNT(*) FILTER (WHERE m.movement_type = 'transfer') as transfers_count,
                COUNT(*) FILTER (WHERE m.movement_type = 'adjustment') as adjustments_count,
                COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type = 'entry'), 0)::float8 as entries_quantity,
                COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type = 'exit'), 0)::float8 as exits_quantity
            FROM movements m
            LEFT JOIN locations fl ON m.from_location_id = fl.id
            LEFT JOIN locations tl ON m.to_location_id = tl.id
            WHERE m.created_at >= $1::date AND m.created_at < ($2::date + INTERVAL '1 day')
            AND (fl.warehouse_id = $3 OR tl.warehouse_id = $3)
            "#,
        )
        .bind(start_date)
        .bind(end_date)
        .bind(wid)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, MovementsSummaryRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE movement_type = 'entry') as entries_count,
                COUNT(*) FILTER (WHERE movement_type = 'exit') as exits_count,
                COUNT(*) FILTER (WHERE movement_type = 'transfer') as transfers_count,
                COUNT(*) FILTER (WHERE movement_type = 'adjustment') as adjustments_count,
                COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'entry'), 0)::float8 as entries_quantity,
                COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'exit'), 0)::float8 as exits_quantity
            FROM movements
            WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
            "#,
        )
        .bind(start_date)
        .bind(end_date)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(row)
}

pub async fn get_stock_by_category(
    pool: &PgPool,
    warehouse_ids: Option<&[Uuid]>,
) -> Result<Vec<StockByCategoryRow>, DomainError> {
    let rows = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, StockByCategoryRow>(
            r#"
            SELECT c.id as category_id, c.name as category_name,
                   COALESCE(SUM(i.quantity), 0)::float8 as total_quantity,
                   COUNT(DISTINCT p.id) as product_count
            FROM categories c
            LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
            LEFT JOIN inventory i ON i.product_id = p.id
            LEFT JOIN locations l ON i.location_id = l.id AND l.warehouse_id = ANY($1)
            GROUP BY c.id, c.name
            ORDER BY total_quantity DESC
            "#,
        )
        .bind(wids)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, StockByCategoryRow>(
            r#"
            SELECT c.id as category_id, c.name as category_name,
                   COALESCE(SUM(i.quantity), 0)::float8 as total_quantity,
                   COUNT(DISTINCT p.id) as product_count
            FROM categories c
            LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
            LEFT JOIN inventory i ON i.product_id = p.id
            GROUP BY c.id, c.name
            ORDER BY total_quantity DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(rows)
}
