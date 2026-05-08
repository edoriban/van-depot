//! Cycle counts repository — free functions.
//!
//! Phase B batch 7 (multi-tenant-foundation, design §5.4) collapsed the
//! `PgCycleCountRepository` struct/impl shape into the canonical
//! tenant-aware free-function shape established by B1..B6:
//!   * Read functions take `(&mut PgConnection, tenant_id, ...)`.
//!   * Write functions that begin their own tx take `(&PgPool, tenant_id, ...)`.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N`. The
//! composite FKs installed by 20260508000007 reject any cross-tenant
//! INSERT/UPDATE at the DB layer, so the predicate is belt-and-suspenders.
//!
//! Identity correctness: `find_by_id` filters on BOTH `id` and `tenant_id`;
//! cross-tenant probes resolve to `NotFound` rather than leaking existence.
//!
//! `apply_adjustments` writes to B4 tables (movements, inventory). With B7
//! cycle_counts itself carrying tenant_id, the inline B4-era
//! `fetch_warehouse_tenant_id` shim (which derived tenant_id from
//! `cycle_counts.warehouse_id → warehouses.tenant_id`) is GONE — tenant_id
//! flows in as the function parameter.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::cycle_count::{CycleCount, CycleCountItem, CycleCountStatus};

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct CycleCountRow {
    id: Uuid,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    name: String,
    status: CycleCountStatus,
    created_by: Uuid,
    completed_at: Option<DateTime<Utc>>,
    notes: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CycleCountRow> for CycleCount {
    fn from(row: CycleCountRow) -> Self {
        CycleCount {
            id: row.id,
            tenant_id: row.tenant_id,
            warehouse_id: row.warehouse_id,
            name: row.name,
            status: row.status,
            created_by: row.created_by,
            completed_at: row.completed_at,
            notes: row.notes,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct CycleCountItemRow {
    id: Uuid,
    tenant_id: Uuid,
    cycle_count_id: Uuid,
    product_id: Uuid,
    location_id: Uuid,
    system_quantity: f64,
    counted_quantity: Option<f64>,
    variance: Option<f64>,
    counted_by: Option<Uuid>,
    counted_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    product_name: Option<String>,
    product_sku: Option<String>,
    location_name: Option<String>,
}

impl From<CycleCountItemRow> for CycleCountItem {
    fn from(row: CycleCountItemRow) -> Self {
        CycleCountItem {
            id: row.id,
            tenant_id: row.tenant_id,
            cycle_count_id: row.cycle_count_id,
            product_id: row.product_id,
            location_id: row.location_id,
            system_quantity: row.system_quantity,
            counted_quantity: row.counted_quantity,
            variance: row.variance,
            counted_by: row.counted_by,
            counted_at: row.counted_at,
            created_at: row.created_at,
            product_name: row.product_name,
            product_sku: row.product_sku,
            location_name: row.location_name,
        }
    }
}

// ── Summary struct ──────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct CycleCountSummary {
    pub total_items: i64,
    pub counted_items: i64,
    pub discrepancy_count: i64,
}

// ── SQL fragments ───────────────────────────────────────────────────

const CYCLE_COUNT_COLUMNS: &str = "id, tenant_id, warehouse_id, name, status, created_by, \
                                    completed_at, notes, created_at, updated_at";

const CYCLE_COUNT_ITEM_SELECT: &str = "\
    ci.id, ci.tenant_id, ci.cycle_count_id, ci.product_id, ci.location_id, \
    ci.system_quantity::float8, ci.counted_quantity::float8, ci.variance::float8, \
    ci.counted_by, ci.counted_at, ci.created_at, \
    p.name AS product_name, p.sku AS product_sku, l.name AS location_name";

// ── Queries ─────────────────────────────────────────────────────────

pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    name: &str,
    notes: Option<&str>,
    created_by: Uuid,
) -> Result<CycleCount, DomainError> {

    // Create the cycle count session (carries tenant_id; composite FK
    // `cycle_counts(tenant_id, warehouse_id) → warehouses(tenant_id, id)`
    // rejects cross-tenant warehouse_id at the DB layer with 23503).
    let sql = format!(
        "INSERT INTO cycle_counts (tenant_id, warehouse_id, name, notes, created_by) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING {CYCLE_COUNT_COLUMNS}"
    );
    let cc_row = sqlx::query_as::<_, CycleCountRow>(&sql)
        .bind(tenant_id)
        .bind(warehouse_id)
        .bind(name)
        .bind(notes)
        .bind(created_by)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    // Populate items from current inventory snapshot for this warehouse.
    // Exclude tool_spare products — they are tracked as tool_instances, not
    // inventory counts. Mirrors the exclusion used in alerts_repo.rs.
    //
    // Tenant-scoped at every JOIN: only consider inventory/locations/products
    // belonging to the same tenant. The inserted cycle_count_items rows
    // carry the same tenant_id as the parent.
    sqlx::query(
        "INSERT INTO cycle_count_items (tenant_id, cycle_count_id, product_id, location_id, system_quantity) \
         SELECT $1, $2, i.product_id, i.location_id, i.quantity \
         FROM inventory i \
         JOIN locations l ON i.location_id = l.id AND l.tenant_id = i.tenant_id \
         JOIN products p ON i.product_id = p.id AND p.tenant_id = i.tenant_id \
         WHERE i.tenant_id = $1 AND l.warehouse_id = $3 AND i.quantity > 0 \
           AND p.product_class <> 'tool_spare'",
    )
    .bind(tenant_id)
    .bind(cc_row.id)
    .bind(warehouse_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(CycleCount::from(cc_row))
}

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<CycleCount>, DomainError> {
    let sql = format!(
        "SELECT {CYCLE_COUNT_COLUMNS} FROM cycle_counts \
         WHERE id = $1 AND tenant_id = $2"
    );
    let row = sqlx::query_as::<_, CycleCountRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(CycleCount::from))
}

pub async fn get_summary(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    cycle_count_id: Uuid,
) -> Result<CycleCountSummary, DomainError> {
    let row = sqlx::query_as::<_, CycleCountSummary>(
        "SELECT \
            COUNT(*)::bigint AS total_items, \
            COUNT(counted_quantity)::bigint AS counted_items, \
            COUNT(*) FILTER (WHERE variance IS NOT NULL AND variance != 0)::bigint AS discrepancy_count \
         FROM cycle_count_items \
         WHERE cycle_count_id = $1 AND tenant_id = $2",
    )
    .bind(cycle_count_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Option<Uuid>,
    status: Option<CycleCountStatus>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<CycleCount>, i64), DomainError> {
    // Tenant filter is the first bind ($1); subsequent optional filters
    // are appended in declaration order.
    let mut where_clauses: Vec<String> = vec!["tenant_id = $1".to_string()];
    let mut idx: usize = 1;

    if warehouse_id.is_some() {
        idx += 1;
        where_clauses.push(format!("warehouse_id = ${idx}"));
    }
    if status.is_some() {
        idx += 1;
        where_clauses.push(format!("status = ${idx}"));
    }

    let where_sql = where_clauses.join(" AND ");

    // Count
    let count_sql = format!("SELECT COUNT(*) FROM cycle_counts WHERE {where_sql}");
    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql).bind(tenant_id);
    if let Some(wid) = warehouse_id {
        count_query = count_query.bind(wid);
    }
    if let Some(ref s) = status {
        count_query = count_query.bind(s);
    }

    let total = count_query
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .0;

    // Data
    idx += 1;
    let limit_idx = idx;
    idx += 1;
    let offset_idx = idx;

    let data_sql = format!(
        "SELECT {CYCLE_COUNT_COLUMNS} FROM cycle_counts \
         WHERE {where_sql} \
         ORDER BY created_at DESC \
         LIMIT ${limit_idx} OFFSET ${offset_idx}"
    );
    let mut data_query = sqlx::query_as::<_, CycleCountRow>(&data_sql).bind(tenant_id);
    if let Some(wid) = warehouse_id {
        data_query = data_query.bind(wid);
    }
    if let Some(ref s) = status {
        data_query = data_query.bind(s);
    }
    data_query = data_query.bind(limit).bind(offset);

    let rows = data_query
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total))
}

pub async fn list_items(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    cycle_count_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<CycleCountItem>, i64), DomainError> {
    let count = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*) FROM cycle_count_items \
         WHERE cycle_count_id = $1 AND tenant_id = $2",
    )
    .bind(cycle_count_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .0;

    let sql = format!(
        "SELECT {CYCLE_COUNT_ITEM_SELECT} \
         FROM cycle_count_items ci \
         JOIN products p ON ci.product_id = p.id AND p.tenant_id = ci.tenant_id \
         JOIN locations l ON ci.location_id = l.id AND l.tenant_id = ci.tenant_id \
         WHERE ci.cycle_count_id = $1 AND ci.tenant_id = $2 \
         ORDER BY p.name ASC, l.name ASC \
         LIMIT $3 OFFSET $4"
    );
    let rows = sqlx::query_as::<_, CycleCountItemRow>(&sql)
        .bind(cycle_count_id)
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), count))
}

pub async fn find_item_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CycleCountItem>, DomainError> {
    let sql = format!(
        "SELECT {CYCLE_COUNT_ITEM_SELECT} \
         FROM cycle_count_items ci \
         JOIN products p ON ci.product_id = p.id AND p.tenant_id = ci.tenant_id \
         JOIN locations l ON ci.location_id = l.id AND l.tenant_id = ci.tenant_id \
         WHERE ci.id = $1 AND ci.tenant_id = $2"
    );
    let row = sqlx::query_as::<_, CycleCountItemRow>(&sql)
        .bind(item_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Into::into))
}

pub async fn record_count(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    item_id: Uuid,
    counted_quantity: f64,
    counted_by: Uuid,
) -> Result<CycleCountItem, DomainError> {
    sqlx::query(
        "UPDATE cycle_count_items \
         SET counted_quantity = $3, \
             variance = $3 - system_quantity, \
             counted_by = $4, \
             counted_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING id",
    )
    .bind(item_id)
    .bind(tenant_id)
    .bind(counted_quantity)
    .bind(counted_by)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // Re-fetch with JOINs.
    find_item_by_id(&mut *conn, tenant_id, item_id)
        .await?
        .ok_or_else(|| DomainError::NotFound("Cycle count item not found".to_string()))
}

pub async fn update_status(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    new_status: CycleCountStatus,
) -> Result<CycleCount, DomainError> {
    let completed_at_expr = if new_status == CycleCountStatus::Completed {
        "NOW()"
    } else {
        "completed_at"
    };

    let sql = format!(
        "UPDATE cycle_counts \
         SET status = $3, completed_at = {completed_at_expr} \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {CYCLE_COUNT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, CycleCountRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(new_status)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(CycleCount::from(row))
}

pub async fn list_discrepancies(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    cycle_count_id: Uuid,
) -> Result<Vec<CycleCountItem>, DomainError> {
    let sql = format!(
        "SELECT {CYCLE_COUNT_ITEM_SELECT} \
         FROM cycle_count_items ci \
         JOIN products p ON ci.product_id = p.id AND p.tenant_id = ci.tenant_id \
         JOIN locations l ON ci.location_id = l.id AND l.tenant_id = ci.tenant_id \
         WHERE ci.cycle_count_id = $1 AND ci.tenant_id = $2 \
           AND ci.variance IS NOT NULL \
           AND ci.variance != 0 \
         ORDER BY ABS(ci.variance) DESC"
    );
    let rows = sqlx::query_as::<_, CycleCountItemRow>(&sql)
        .bind(cycle_count_id)
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Transactionally: for each item with variance != 0, create an
/// adjustment movement + update inventory, then mark the count completed.
///
/// Phase B B7 collapse: tenant_id is the function parameter — the B4-era
/// inline `SELECT w.tenant_id FROM cycle_counts cc JOIN warehouses w ...`
/// shim is GONE. Caller passes the tenant from claims; the tenant-scoped
/// `find_by_id` / `update_status` queries already reject cross-tenant
/// probes at the application layer, and the composite FKs reject
/// cross-tenant writes at the DB layer.
pub async fn apply_adjustments(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    cycle_count_id: Uuid,
    user_id: Uuid,
) -> Result<CycleCount, DomainError> {

    // Fetch all items with non-zero variance (tenant-scoped).
    let items = sqlx::query_as::<_, CycleCountItemRow>(
        &format!(
            "SELECT {CYCLE_COUNT_ITEM_SELECT} \
             FROM cycle_count_items ci \
             JOIN products p ON ci.product_id = p.id AND p.tenant_id = ci.tenant_id \
             JOIN locations l ON ci.location_id = l.id AND l.tenant_id = ci.tenant_id \
             WHERE ci.cycle_count_id = $1 AND ci.tenant_id = $2 \
               AND ci.variance IS NOT NULL \
               AND ci.variance != 0"
        ),
    )
    .bind(cycle_count_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let reference = format!("cycle-count:{cycle_count_id}");

    for item in &items {
        let new_qty = item.counted_quantity.unwrap_or(0.0);
        let delta = item.variance.unwrap_or(0.0);

        // Upsert inventory to counted_quantity (carries tenant_id post-B4).
        sqlx::query(
            "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = $4, updated_at = NOW()",
        )
        .bind(tenant_id)
        .bind(item.product_id)
        .bind(item.location_id)
        .bind(new_qty)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // Insert adjustment movement (carries tenant_id post-B4).
        sqlx::query(
            "INSERT INTO movements \
                 (tenant_id, product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, $3, $3, $4, 'adjustment', $5, $6, $7, NULL)",
        )
        .bind(tenant_id)
        .bind(item.product_id)
        .bind(item.location_id)
        .bind(delta)
        .bind(user_id)
        .bind(&reference)
        .bind(format!(
            "Cycle count adjustment: system={}, counted={}",
            item.system_quantity, new_qty
        ))
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // Mark cycle count as completed (tenant-scoped).
    let sql = format!(
        "UPDATE cycle_counts \
         SET status = 'completed', completed_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 \
         RETURNING {CYCLE_COUNT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, CycleCountRow>(&sql)
        .bind(cycle_count_id)
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(CycleCount::from(row))
}
