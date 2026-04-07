use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Search result row (T21) ────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct MapSearchResultRow {
    pub zone_id: Uuid,
    pub zone_name: String,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub quantity: f64,
    pub location_name: String,
}

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
    pub pos_x: Option<f32>,
    pub pos_y: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
}

#[derive(sqlx::FromRow)]
pub struct CanvasDimensionsRow {
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
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
            SELECT l.id, l.name, l.pos_x, l.pos_y, l.width, l.height FROM locations l
            WHERE l.warehouse_id = $1 AND l.parent_id IS NULL AND l.is_active = true
        ),
        zone_inventory AS (
            SELECT
                rz.id AS zone_id, rz.name AS zone_name,
                rz.pos_x, rz.pos_y, rz.width, rz.height,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity = 0) AS critical_count,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity > 0 AND i.quantity <= p.min_stock * 0.5) AS low_count,
                COUNT(*) FILTER (WHERE p.min_stock > 0 AND i.quantity > p.min_stock * 0.5 AND i.quantity <= p.min_stock) AS warning_count,
                COUNT(*) FILTER (WHERE p.min_stock = 0 OR i.quantity > p.min_stock) AS ok_count,
                COUNT(i.id) AS total_items
            FROM root_zones rz
            LEFT JOIN location_zones lz ON lz.root_zone_id = rz.id
            LEFT JOIN inventory i ON i.location_id = lz.location_id
            LEFT JOIN products p ON i.product_id = p.id AND p.deleted_at IS NULL
            GROUP BY rz.id, rz.name, rz.pos_x, rz.pos_y, rz.width, rz.height
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
            zi.total_items, COALESCE(zc.child_count, 0)::int8 AS child_location_count,
            zi.pos_x, zi.pos_y, zi.width, zi.height
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

pub async fn get_canvas_dimensions(
    pool: &PgPool,
    warehouse_id: Uuid,
) -> Result<CanvasDimensionsRow, DomainError> {
    let row = sqlx::query_as::<_, CanvasDimensionsRow>(
        "SELECT canvas_width, canvas_height FROM warehouses WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(warehouse_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    row.ok_or_else(|| DomainError::NotFound("Warehouse not found".to_string()))
}

// ── Layout update (T05) ────────────────────────────────────────────

pub async fn update_layout(
    pool: &PgPool,
    warehouse_id: Uuid,
    canvas_width: Option<f32>,
    canvas_height: Option<f32>,
    locations: &[(Uuid, f32, f32, f32, f32)],
) -> Result<u64, DomainError> {
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // Update canvas dimensions if provided
    if canvas_width.is_some() || canvas_height.is_some() {
        sqlx::query(
            "UPDATE warehouses SET \
                canvas_width = COALESCE($2, canvas_width), \
                canvas_height = COALESCE($3, canvas_height), \
                updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(warehouse_id)
        .bind(canvas_width)
        .bind(canvas_height)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    // Update each location's position
    let mut updated: u64 = 0;
    for &(loc_id, px, py, w, h) in locations {
        let result = sqlx::query(
            "UPDATE locations SET pos_x = $2, pos_y = $3, width = $4, height = $5, updated_at = NOW() \
             WHERE id = $1 AND warehouse_id = $6",
        )
        .bind(loc_id)
        .bind(px)
        .bind(py)
        .bind(w)
        .bind(h)
        .bind(warehouse_id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        updated += result.rows_affected();
    }

    tx.commit().await.map_err(map_sqlx_error)?;

    Ok(updated)
}

// ── Map search (T21) ──────────────────────────────────────────────

pub async fn search_map(
    pool: &PgPool,
    warehouse_id: Uuid,
    query: &str,
) -> Result<Vec<MapSearchResultRow>, DomainError> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

    let rows = sqlx::query_as::<_, MapSearchResultRow>(
        r#"
        WITH RECURSIVE zone_tree AS (
            -- Start from all active locations in this warehouse
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
        )
        SELECT DISTINCT ON (p.id, lz.root_zone_id)
            lz.root_zone_id AS zone_id,
            rz.name AS zone_name,
            p.id AS product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            i.quantity::float8 AS quantity,
            l.name AS location_name
        FROM inventory i
        JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
        JOIN locations l ON l.id = i.location_id
        JOIN location_zones lz ON lz.location_id = l.id
        JOIN locations rz ON rz.id = lz.root_zone_id
        WHERE l.warehouse_id = $1
          AND (p.name ILIKE $2 OR p.sku ILIKE $2)
        ORDER BY p.id, lz.root_zone_id, i.quantity DESC
        LIMIT 20
        "#,
    )
    .bind(warehouse_id)
    .bind(&pattern)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}
