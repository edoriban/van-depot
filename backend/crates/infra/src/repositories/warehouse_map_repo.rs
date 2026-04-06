use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct ZoneHealthRow {
    pub zone_id: Uuid,
    pub zone_name: String,
    pub severity: String,
    pub critical_count: i64,
    pub low_count: i64,
    pub warning_count: i64,
    pub ok_count: i64,
    pub total_items: i64,
    pub child_location_count: i64,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn get_warehouse_map(
    pool: &PgPool,
    warehouse_id: Uuid,
) -> Result<Vec<ZoneHealthRow>, DomainError> {
    let rows = sqlx::query_as::<_, ZoneHealthRow>(
        r#"
        WITH RECURSIVE zone_tree AS (
            SELECT l.id, l.parent_id,
                CASE WHEN l.parent_id IS NULL THEN l.id ELSE l.parent_id END AS root_zone_id
            FROM locations l
            WHERE l.warehouse_id = $1 AND l.is_active = true
            UNION ALL
            SELECT child.id, child.parent_id, parent.root_zone_id
            FROM locations child
            INNER JOIN zone_tree parent ON child.parent_id = parent.id
            WHERE child.warehouse_id = $1 AND child.is_active = true
        ),
        location_zones AS (
            SELECT DISTINCT ON (id) id AS location_id, root_zone_id
            FROM zone_tree ORDER BY id, root_zone_id
        ),
        root_zones AS (
            SELECT l.id, l.name FROM locations l
            WHERE l.warehouse_id = $1 AND l.parent_id IS NULL AND l.is_active = true
        ),
        zone_inventory AS (
            SELECT
                rz.id AS zone_id, rz.name AS zone_name,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity = 0) AS critical_count,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity > 0 AND i.quantity <= p.min_stock * 0.5) AS low_count,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity > p.min_stock * 0.5 AND i.quantity <= p.min_stock) AS warning_count,
                COUNT(*) FILTER (WHERE p.min_stock = 0 OR i.quantity > p.min_stock) AS ok_count,
                COUNT(i.id) AS total_items
            FROM root_zones rz
            LEFT JOIN location_zones lz ON lz.root_zone_id = rz.id
            LEFT JOIN inventory i ON i.location_id = lz.location_id
            LEFT JOIN products p ON i.product_id = p.id AND p.deleted_at IS NULL
            GROUP BY rz.id, rz.name
        ),
        zone_children AS (
            SELECT l.parent_id AS zone_id, COUNT(*) AS child_count
            FROM locations l
            WHERE l.warehouse_id = $1 AND l.parent_id IS NOT NULL AND l.is_active = true
            GROUP BY l.parent_id
        )
        SELECT
            zi.zone_id, zi.zone_name,
            CASE
                WHEN zi.total_items = 0 THEN 'empty'
                WHEN zi.critical_count > 0 THEN 'critical'
                WHEN zi.low_count > 0 THEN 'low'
                WHEN zi.warning_count > 0 THEN 'warning'
                ELSE 'ok'
            END AS severity,
            zi.critical_count, zi.low_count, zi.warning_count, zi.ok_count,
            zi.total_items, COALESCE(zc.child_count, 0)::int8 AS child_location_count
        FROM zone_inventory zi
        LEFT JOIN zone_children zc ON zc.zone_id = zi.zone_id
        ORDER BY
            CASE
                WHEN zi.total_items = 0 THEN 5
                WHEN zi.critical_count > 0 THEN 1
                WHEN zi.low_count > 0 THEN 2
                WHEN zi.warning_count > 0 THEN 3
                ELSE 4
            END ASC, zi.zone_name ASC
        "#,
    )
    .bind(warehouse_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}
