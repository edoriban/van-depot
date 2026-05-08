//! Notifications repository — free functions.
//!
//! Phase B batch 7 (multi-tenant-foundation, design §5.4) added the
//! `tenant_id` parameter to every query. The shape was already
//! free-functions; B7 only threads tenant_id through.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N` alongside
//! the existing `WHERE user_id = $M` filter. The notifications table is
//! a leaf — nothing composite-FKs to it — so there's no `(tenant_id, id)`
//! UNIQUE installed, and `user_id` STAYS a single-column FK to global
//! users (B4 §10 movements.user_id template). For a multi-membership
//! user, the same global user_id can appear in rows belonging to
//! different tenants; the `tenant_id` predicate scopes reads to the
//! active tenant.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct NotificationRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
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
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
    is_read: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<NotificationRow>, i64), DomainError> {
    let rows = if let Some(read_filter) = is_read {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT id, tenant_id, user_id, notification_type::text, title, body, is_read,
                   reference_id, reference_type, metadata, created_at, read_at
            FROM notifications
            WHERE tenant_id = $1 AND user_id = $2 AND is_read = $3
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(read_filter)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT id, tenant_id, user_id, notification_type::text, title, body, is_read,
                   reference_id, reference_type, metadata, created_at, read_at
            FROM notifications
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
    };

    let total = if let Some(read_filter) = is_read {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE tenant_id = $1 AND user_id = $2 AND is_read = $3
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(read_filter)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .count
    } else {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE tenant_id = $1 AND user_id = $2
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .count
    };

    Ok((rows, total))
}

pub async fn get_unread_count(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
) -> Result<i64, DomainError> {
    let row = sqlx::query_as::<_, CountRow>(
        r#"
        SELECT COUNT(*) as count
        FROM notifications
        WHERE tenant_id = $1 AND user_id = $2 AND is_read = false
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.count)
}

pub async fn mark_as_read(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    notification_id: Uuid,
    user_id: Uuid,
) -> Result<NotificationRow, DomainError> {
    let row = sqlx::query_as::<_, NotificationRow>(
        r#"
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        RETURNING id, tenant_id, user_id, notification_type::text, title, body, is_read,
                  reference_id, reference_type, metadata, created_at, read_at
        "#,
    )
    .bind(notification_id)
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Notification not found".to_string()))?;

    Ok(row)
}

pub async fn mark_all_as_read(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    user_id: Uuid,
) -> Result<i64, DomainError> {
    let row = sqlx::query_as::<_, CountRow>(
        r#"
        WITH updated AS (
            UPDATE notifications
            SET is_read = true, read_at = NOW()
            WHERE tenant_id = $1 AND user_id = $2 AND is_read = false
            RETURNING 1
        )
        SELECT COUNT(*) as count FROM updated
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.count)
}

pub async fn get_daily_summary(
    conn: &mut PgConnection,
    tenant_id: Uuid,
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
        WHERE tenant_id = $1 AND user_id = $2 AND created_at >= CURRENT_DATE
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

/// Generates `notifications` rows from current low/critical stock alerts
/// in this tenant.
///
/// Phase B B7: tenant-scoped at every layer:
///   * The CTE `stock_alerts` filters inventory + warehouses by tenant_id,
///     so the candidate set is exclusively this tenant's inventory.
///   * The INSERT writes `tenant_id` alongside `user_id`.
///   * The dedup constraint `(user_id, dedup_key)` is preserved as-is —
///     the dedup_key embeds product_id (tenant-scoped post-B2), so
///     cross-tenant collisions are practically impossible.
pub async fn generate_from_stock_alerts(
    conn: &mut PgConnection,
    tenant_id: Uuid,
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
                JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id
                JOIN locations l ON i.location_id = l.id AND l.tenant_id = i.tenant_id
                JOIN warehouses w ON l.warehouse_id = w.id AND w.tenant_id = l.tenant_id
                WHERE i.tenant_id = $1
                  AND p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
                  AND l.warehouse_id = ANY($3)
            ),
            inserted AS (
                INSERT INTO notifications (tenant_id, user_id, notification_type, title, body, reference_id, reference_type, dedup_key)
                SELECT
                    $1,
                    $2,
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
        .bind(tenant_id)
        .bind(user_id)
        .bind(wids)
        .fetch_one(&mut *conn)
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
                JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id
                JOIN locations l ON i.location_id = l.id AND l.tenant_id = i.tenant_id
                JOIN warehouses w ON l.warehouse_id = w.id AND w.tenant_id = l.tenant_id
                WHERE i.tenant_id = $1
                  AND p.deleted_at IS NULL AND w.deleted_at IS NULL
                  AND p.min_stock > 0 AND i.quantity <= p.min_stock
            ),
            inserted AS (
                INSERT INTO notifications (tenant_id, user_id, notification_type, title, body, reference_id, reference_type, dedup_key)
                SELECT
                    $1,
                    $2,
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
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
    };

    // To get the skipped count, we need the total alerts count (tenant-scoped).
    let total = if let Some(wids) = warehouse_ids {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM inventory i
            JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id
            JOIN locations l ON i.location_id = l.id AND l.tenant_id = i.tenant_id
            JOIN warehouses w ON l.warehouse_id = w.id AND w.tenant_id = l.tenant_id
            WHERE i.tenant_id = $1
              AND p.deleted_at IS NULL AND w.deleted_at IS NULL
              AND p.min_stock > 0 AND i.quantity <= p.min_stock
              AND l.warehouse_id = ANY($2)
            "#,
        )
        .bind(tenant_id)
        .bind(wids)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM inventory i
            JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id
            JOIN locations l ON i.location_id = l.id AND l.tenant_id = i.tenant_id
            JOIN warehouses w ON l.warehouse_id = w.id AND w.tenant_id = l.tenant_id
            WHERE i.tenant_id = $1
              AND p.deleted_at IS NULL AND w.deleted_at IS NULL
              AND p.min_stock > 0 AND i.quantity <= p.min_stock
            "#,
        )
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
    };

    let created = row.count;
    let skipped = total.count - created;

    Ok((created, skipped))
}
