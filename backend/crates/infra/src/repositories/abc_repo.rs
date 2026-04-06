use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct AbcItemRow {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub movement_count: i64,
    pub total_quantity: f64,
    pub classification: String,
    pub cumulative_percentage: f64,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_abc_classification(
    pool: &PgPool,
    period_days: i64,
    warehouse_id: Option<Uuid>,
) -> Result<Vec<AbcItemRow>, DomainError> {
    let rows = if let Some(wid) = warehouse_id {
        sqlx::query_as::<_, AbcItemRow>(
            r#"
            WITH movement_counts AS (
                SELECT
                    m.product_id,
                    p.name as product_name,
                    p.sku as product_sku,
                    COUNT(*) as movement_count,
                    COALESCE(SUM(m.quantity), 0)::float8 as total_quantity
                FROM movements m
                JOIN products p ON m.product_id = p.id
                LEFT JOIN locations fl ON m.from_location_id = fl.id
                LEFT JOIN locations tl ON m.to_location_id = tl.id
                WHERE p.deleted_at IS NULL
                  AND m.created_at >= NOW() - INTERVAL '1 day' * $1
                  AND (fl.warehouse_id = $2 OR tl.warehouse_id = $2)
                GROUP BY m.product_id, p.name, p.sku
                ORDER BY movement_count DESC
            ),
            ranked AS (
                SELECT *,
                    SUM(movement_count) OVER () as grand_total,
                    SUM(movement_count) OVER (ORDER BY movement_count DESC) as running_total
                FROM movement_counts
            )
            SELECT
                product_id, product_name, product_sku,
                movement_count, total_quantity,
                CASE
                    WHEN running_total::float8 / NULLIF(grand_total, 0)::float8 <= 0.80 THEN 'A'
                    WHEN running_total::float8 / NULLIF(grand_total, 0)::float8 <= 0.95 THEN 'B'
                    ELSE 'C'
                END as classification,
                COALESCE(running_total::float8 / NULLIF(grand_total, 0)::float8 * 100, 0) as cumulative_percentage
            FROM ranked
            ORDER BY movement_count DESC
            "#,
        )
        .bind(period_days as f64)
        .bind(wid)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    } else {
        sqlx::query_as::<_, AbcItemRow>(
            r#"
            WITH movement_counts AS (
                SELECT
                    m.product_id,
                    p.name as product_name,
                    p.sku as product_sku,
                    COUNT(*) as movement_count,
                    COALESCE(SUM(m.quantity), 0)::float8 as total_quantity
                FROM movements m
                JOIN products p ON m.product_id = p.id
                WHERE p.deleted_at IS NULL
                  AND m.created_at >= NOW() - INTERVAL '1 day' * $1
                GROUP BY m.product_id, p.name, p.sku
                ORDER BY movement_count DESC
            ),
            ranked AS (
                SELECT *,
                    SUM(movement_count) OVER () as grand_total,
                    SUM(movement_count) OVER (ORDER BY movement_count DESC) as running_total
                FROM movement_counts
            )
            SELECT
                product_id, product_name, product_sku,
                movement_count, total_quantity,
                CASE
                    WHEN running_total::float8 / NULLIF(grand_total, 0)::float8 <= 0.80 THEN 'A'
                    WHEN running_total::float8 / NULLIF(grand_total, 0)::float8 <= 0.95 THEN 'B'
                    ELSE 'C'
                END as classification,
                COALESCE(running_total::float8 / NULLIF(grand_total, 0)::float8 * 100, 0) as cumulative_percentage
            FROM ranked
            ORDER BY movement_count DESC
            "#,
        )
        .bind(period_days as f64)
        .fetch_all(pool)
        .await
        .map_err(map_sqlx_error)?
    };

    Ok(rows)
}
