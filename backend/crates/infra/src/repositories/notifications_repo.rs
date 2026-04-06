use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct NotificationRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub is_read: bool,
    pub reference_id: Option<Uuid>,
    pub reference_type: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub read_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
pub struct CountRow {
    pub count: i64,
}

#[derive(sqlx::FromRow)]
pub struct DailySummaryRow {
    pub total_today: i64,
    pub unread_today: i64,
    pub stock_critical: i64,
    pub stock_low: i64,
    pub stock_warning: i64,
    pub cycle_count_due: i64,
    pub system: i64,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn list_notifications(
    pool: &PgPool,
    user_id: Uuid,
    is_read: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<NotificationRow>, i64), DomainError> {
    let rows = if let Some(read_filter) = is_read {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT id, user_id, notification_type::text, title, body, is_read,
                   reference_id, reference_type, metadata, created_at, read_at
            FROM notifications
            WHERE user_id = $1 AND is_read = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
        )
        .bind(user_id)
        .bind(read_filter)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT id, user_id, notification_type::text, title, body, is_read,
                   reference_id, reference_type, metadata, created_at, read_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    let total = if let Some(read_filter) = is_read {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1 AND is_read = $2
            "#,
        )
        .bind(user_id)
        .bind(read_filter)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
        .count
    } else {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
        .count
    };

    Ok((rows, total))
}

pub async fn get_unread_count(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<i64, DomainError> {
    let row = sqlx::query_as::<_, CountRow>(
        r#"
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = $1 AND is_read = false
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.count)
}

pub async fn mark_as_read(
    pool: &PgPool,
    notification_id: Uuid,
    user_id: Uuid,
) -> Result<NotificationRow, DomainError> {
    let row = sqlx::query_as::<_, NotificationRow>(
        r#"
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, user_id, notification_type::text, title, body, is_read,
                  reference_id, reference_type, metadata, created_at, read_at
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Notification not found".to_string()))?;

    Ok(row)
}

pub async fn mark_all_as_read(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<i64, DomainError> {
    let row = sqlx::query_as::<_, CountRow>(
        r#"
        WITH updated AS (
            UPDATE notifications
            SET is_read = true, read_at = NOW()
            WHERE user_id = $1 AND is_read = false
            RETURNING 1
        )
        SELECT COUNT(*) as count FROM updated
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.count)
}

pub async fn get_daily_summary(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<DailySummaryRow, DomainError> {
    let row = sqlx::query_as::<_, DailySummaryRow>(
        r#"
        SELECT
            COUNT(*) as total_today,
            COUNT(*) FILTER (WHERE is_read = false) as unread_today,
            COUNT(*) FILTER (WHERE notification_type = 'stock_critical') as stock_critical,
            COUNT(*) FILTER (WHERE notification_type = 'stock_low') as stock_low,
            COUNT(*) FILTER (WHERE notification_type = 'stock_warning') as stock_warning,
            COUNT(*) FILTER (WHERE notification_type = 'cycle_count_due') as cycle_count_due,
            COUNT(*) FILTER (WHERE notification_type = 'system') as system
        FROM notifications
        WHERE user_id = $1 AND created_at >= CURRENT_DATE
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn generate_from_stock_alerts(
    pool: &PgPool,
    user_id: Uuid,
    warehouse_ids: Option<&[Uuid]>,
) -> Result<(i64, i64), DomainError> {
    let row = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, CountRow>(
            r#"
            WITH stock_alerts AS (
                SELECT
                    i.product_id,
                    p.name as product_name,
                    p.sku,
                    i.location_id,
                    l.name as location_name,
                    i.quantity,
                    p.min_stock,
                    CASE
                        WHEN i.quantity = 0 THEN 'stock_critical'
                        WHEN i.quantity <= p.min_stock * 0.5 THEN 'stock_low'
                        ELSE 'stock_warning'
                    END as alert_type,
                    CASE
                        WHEN i.quantity = 0 THEN 'Stock critico: ' || p.name
                        WHEN i.quantity <= p.min_stock * 0.5 THEN 'Stock bajo: ' || p.name
                        ELSE 'Advertencia de stock: ' || p.name
                    END as title,
                    p.name || ' (' || p.sku || ') en ' || l.name || ' - Cantidad: ' || i.quantity || '/' || p.min_stock as body,
                    'stock:' || i.product_id || ':' || i.location_id as dedup_key
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                  AND l.warehouse_id = ANY($2)
            ),
            inserted AS (
                INSERT INTO notifications (user_id, notification_type, title, body, reference_id, reference_type, dedup_key)
                SELECT
                    $1,
                    alert_type::notification_type,
                    title,
                    body,
                    product_id,
                    'product',
                    dedup_key
                FROM stock_alerts
                ON CONFLICT (user_id, dedup_key) DO NOTHING
                RETURNING 1
            )
            SELECT COUNT(*) as count FROM inserted
            "#,
        )
        .bind(user_id)
        .bind(wids)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, CountRow>(
            r#"
            WITH stock_alerts AS (
                SELECT
                    i.product_id,
                    p.name as product_name,
                    p.sku,
                    i.location_id,
                    l.name as location_name,
                    i.quantity,
                    p.min_stock,
                    CASE
                        WHEN i.quantity = 0 THEN 'stock_critical'
                        WHEN i.quantity <= p.min_stock * 0.5 THEN 'stock_low'
                        ELSE 'stock_warning'
                    END as alert_type,
                    CASE
                        WHEN i.quantity = 0 THEN 'Stock critico: ' || p.name
                        WHEN i.quantity <= p.min_stock * 0.5 THEN 'Stock bajo: ' || p.name
                        ELSE 'Advertencia de stock: ' || p.name
                    END as title,
                    p.name || ' (' || p.sku || ') en ' || l.name || ' - Cantidad: ' || i.quantity || '/' || p.min_stock as body,
                    'stock:' || i.product_id || ':' || i.location_id as dedup_key
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                JOIN locations l ON i.location_id = l.id
                JOIN warehouses w ON l.warehouse_id = w.id
                WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
            ),
            inserted AS (
                INSERT INTO notifications (user_id, notification_type, title, body, reference_id, reference_type, dedup_key)
                SELECT
                    $1,
                    alert_type::notification_type,
                    title,
                    body,
                    product_id,
                    'product',
                    dedup_key
                FROM stock_alerts
                ON CONFLICT (user_id, dedup_key) DO NOTHING
                RETURNING 1
            )
            SELECT COUNT(*) as count FROM inserted
            "#,
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    // To get the skipped count, we need the total alerts count
    let total = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
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
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
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

    let created = row.count;
    let skipped = total.count - created;

    Ok((created, skipped))
}
