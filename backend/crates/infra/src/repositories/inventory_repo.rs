use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{LocationType, MovementType};
use vandepot_domain::models::inventory_params::{
    AdjustmentParams, EntryParams, ExitParams, InventoryFilters, InventoryItem, MovementFilters,
    TransferParams,
};
use vandepot_domain::models::movement::Movement;
use vandepot_domain::ports::inventory_service::InventoryService;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct MovementRow {
    id: Uuid,
    product_id: Uuid,
    from_location_id: Option<Uuid>,
    to_location_id: Option<Uuid>,
    quantity: f64,
    movement_type: MovementType,
    user_id: Uuid,
    reference: Option<String>,
    notes: Option<String>,
    supplier_id: Option<Uuid>,
    movement_reason: Option<String>,
    work_order_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

impl From<MovementRow> for Movement {
    fn from(row: MovementRow) -> Self {
        Movement {
            id: row.id,
            product_id: row.product_id,
            from_location_id: row.from_location_id,
            to_location_id: row.to_location_id,
            quantity: row.quantity,
            movement_type: row.movement_type,
            user_id: row.user_id,
            reference: row.reference,
            notes: row.notes,
            supplier_id: row.supplier_id,
            movement_reason: row.movement_reason,
            purchase_order_id: None,
            work_order_id: row.work_order_id,
            created_at: row.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct InventoryItemRow {
    id: Uuid,
    product_id: Uuid,
    product_name: String,
    product_sku: String,
    location_id: Uuid,
    location_name: String,
    warehouse_id: Uuid,
    quantity: f64,
    min_stock: f64,
}

impl From<InventoryItemRow> for InventoryItem {
    fn from(row: InventoryItemRow) -> Self {
        InventoryItem {
            id: row.id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            location_id: row.location_id,
            location_name: row.location_name,
            warehouse_id: row.warehouse_id,
            quantity: row.quantity,
            min_stock: row.min_stock,
        }
    }
}

// ── Movement RETURNING columns ──────────────────────────────────────

const MOVEMENT_COLUMNS: &str = "id, product_id, from_location_id, to_location_id, \
                                quantity::float8, movement_type, user_id, reference, \
                                notes, supplier_id, movement_reason, work_order_id, created_at";

const INVENTORY_ITEM_SELECT: &str = "\
    i.id, i.product_id, p.name AS product_name, p.sku AS product_sku, \
    i.location_id, l.name AS location_name, l.warehouse_id, \
    i.quantity::float8, p.min_stock::float8";

// ── Service struct ──────────────────────────────────────────────────

pub struct PgInventoryService {
    pool: PgPool,
}

impl PgInventoryService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl InventoryService for PgInventoryService {
    // ── record_entry ────────────────────────────────────────────────

    async fn record_entry(&self, params: EntryParams) -> Result<Movement, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Upsert inventory row
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(params.product_id)
        .bind(params.to_location_id)
        .bind(params.quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Insert movement
        let sql = format!(
            "INSERT INTO movements \
                 (product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, NULL, $2, $3, 'entry', $4, $5, $6, $7) \
             RETURNING {MOVEMENT_COLUMNS}"
        );
        let row = sqlx::query_as::<_, MovementRow>(&sql)
            .bind(params.product_id)
            .bind(params.to_location_id)
            .bind(params.quantity)
            .bind(params.user_id)
            .bind(&params.reference)
            .bind(&params.notes)
            .bind(params.supplier_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(Movement::from(row))
    }

    // ── record_exit ─────────────────────────────────────────────────

    async fn record_exit(&self, params: ExitParams) -> Result<Movement, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Lock and check stock
        let current: (f64,) = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
        )
        .bind(params.product_id)
        .bind(params.from_location_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .unwrap_or((0.0,));

        if current.0 < params.quantity {
            return Err(DomainError::Validation("Insufficient stock".to_string()));
        }

        // Decrement inventory
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
             WHERE product_id = $1 AND location_id = $2",
        )
        .bind(params.product_id)
        .bind(params.from_location_id)
        .bind(params.quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Insert movement
        let sql = format!(
            "INSERT INTO movements \
                 (product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, NULL, $3, 'exit', $4, $5, $6, NULL) \
             RETURNING {MOVEMENT_COLUMNS}"
        );
        let row = sqlx::query_as::<_, MovementRow>(&sql)
            .bind(params.product_id)
            .bind(params.from_location_id)
            .bind(params.quantity)
            .bind(params.user_id)
            .bind(&params.reference)
            .bind(&params.notes)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(Movement::from(row))
    }

    // ── record_transfer ─────────────────────────────────────────────

    async fn record_transfer(&self, params: TransferParams) -> Result<Movement, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Lock source and check stock
        let source: (f64,) = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
        )
        .bind(params.product_id)
        .bind(params.from_location_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .unwrap_or((0.0,));

        if source.0 < params.quantity {
            return Err(DomainError::Validation("Insufficient stock".to_string()));
        }

        // Decrement source
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
             WHERE product_id = $1 AND location_id = $2",
        )
        .bind(params.product_id)
        .bind(params.from_location_id)
        .bind(params.quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Upsert destination
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(params.product_id)
        .bind(params.to_location_id)
        .bind(params.quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Insert movement
        let sql = format!(
            "INSERT INTO movements \
                 (product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, $3, $4, 'transfer', $5, $6, $7, NULL) \
             RETURNING {MOVEMENT_COLUMNS}"
        );
        let row = sqlx::query_as::<_, MovementRow>(&sql)
            .bind(params.product_id)
            .bind(params.from_location_id)
            .bind(params.to_location_id)
            .bind(params.quantity)
            .bind(params.user_id)
            .bind(&params.reference)
            .bind(&params.notes)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(Movement::from(row))
    }

    // ── record_adjustment ───────────────────────────────────────────

    async fn record_adjustment(&self, params: AdjustmentParams) -> Result<Movement, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Lock existing row (or treat as 0)
        let old_qty: f64 = sqlx::query_as::<_, (f64,)>(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
        )
        .bind(params.product_id)
        .bind(params.location_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .map(|r| r.0)
        .unwrap_or(0.0);

        let delta = params.new_quantity - old_qty;

        // Upsert inventory to new_quantity
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = $3, updated_at = NOW()",
        )
        .bind(params.product_id)
        .bind(params.location_id)
        .bind(params.new_quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Insert movement with delta as quantity
        let sql = format!(
            "INSERT INTO movements \
                 (product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, $2, $3, 'adjustment', $4, $5, $6, NULL) \
             RETURNING {MOVEMENT_COLUMNS}"
        );
        let row = sqlx::query_as::<_, MovementRow>(&sql)
            .bind(params.product_id)
            .bind(params.location_id)
            .bind(delta)
            .bind(params.user_id)
            .bind(&params.reference)
            .bind(&params.notes)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(Movement::from(row))
    }

    // ── find_movement_by_id ─────────────────────────────────────────

    async fn find_movement_by_id(&self, id: Uuid) -> Result<Option<Movement>, DomainError> {
        let sql = format!(
            "SELECT {MOVEMENT_COLUMNS} FROM movements WHERE id = $1"
        );
        let row = sqlx::query_as::<_, MovementRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(Movement::from))
    }

    // ── list_movements ──────────────────────────────────────────────

    async fn list_movements(
        &self,
        filters: MovementFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Movement>, i64), DomainError> {
        let mut where_clauses: Vec<String> = vec!["TRUE".to_string()];
        let mut idx: usize = 0;

        if filters.product_id.is_some() {
            idx += 1;
            where_clauses.push(format!("product_id = ${idx}"));
        }
        if filters.location_id.is_some() {
            idx += 1;
            where_clauses.push(format!(
                "(from_location_id = ${idx} OR to_location_id = ${idx})"
            ));
        }
        if filters.movement_type.is_some() {
            idx += 1;
            where_clauses.push(format!("movement_type = ${idx}"));
        }
        if filters.start_date.is_some() {
            idx += 1;
            where_clauses.push(format!("created_at >= ${idx}"));
        }
        if filters.end_date.is_some() {
            idx += 1;
            where_clauses.push(format!("created_at <= ${idx}"));
        }
        if filters.work_order_id.is_some() {
            idx += 1;
            where_clauses.push(format!("work_order_id = ${idx}"));
        }

        let where_sql = where_clauses.join(" AND ");

        // Count query
        let count_sql = format!("SELECT COUNT(*) FROM movements WHERE {where_sql}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        if let Some(pid) = filters.product_id {
            count_query = count_query.bind(pid);
        }
        if let Some(lid) = filters.location_id {
            count_query = count_query.bind(lid);
        }
        if let Some(ref mt) = filters.movement_type {
            count_query = count_query.bind(mt);
        }
        if let Some(sd) = filters.start_date {
            count_query = count_query.bind(sd);
        }
        if let Some(ed) = filters.end_date {
            count_query = count_query.bind(ed);
        }
        if let Some(woid) = filters.work_order_id {
            count_query = count_query.bind(woid);
        }

        let total = count_query
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?
            .0;

        // Data query
        idx += 1;
        let limit_idx = idx;
        idx += 1;
        let offset_idx = idx;

        let data_sql = format!(
            "SELECT {MOVEMENT_COLUMNS} FROM movements \
             WHERE {where_sql} \
             ORDER BY created_at DESC \
             LIMIT ${limit_idx} OFFSET ${offset_idx}"
        );
        let mut data_query = sqlx::query_as::<_, MovementRow>(&data_sql);
        if let Some(pid) = filters.product_id {
            data_query = data_query.bind(pid);
        }
        if let Some(lid) = filters.location_id {
            data_query = data_query.bind(lid);
        }
        if let Some(ref mt) = filters.movement_type {
            data_query = data_query.bind(mt);
        }
        if let Some(sd) = filters.start_date {
            data_query = data_query.bind(sd);
        }
        if let Some(ed) = filters.end_date {
            data_query = data_query.bind(ed);
        }
        if let Some(woid) = filters.work_order_id {
            data_query = data_query.bind(woid);
        }
        data_query = data_query.bind(limit).bind(offset);

        let rows = data_query
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
    }

    // ── list_inventory ──────────────────────────────────────────────

    async fn list_inventory(
        &self,
        filters: InventoryFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<InventoryItem>, i64), DomainError> {
        let mut where_clauses = vec!["p.deleted_at IS NULL".to_string()];
        let mut idx: usize = 0;

        if filters.warehouse_id.is_some() {
            idx += 1;
            where_clauses.push(format!("l.warehouse_id = ${idx}"));
        }
        if filters.location_id.is_some() {
            idx += 1;
            where_clauses.push(format!("i.location_id = ${idx}"));
        }
        if filters.product_id.is_some() {
            idx += 1;
            where_clauses.push(format!("i.product_id = ${idx}"));
        }
        if filters.search.is_some() {
            idx += 1;
            where_clauses.push(format!(
                "(p.name ILIKE '%' || ${idx} || '%' OR p.sku ILIKE '%' || ${idx} || '%')"
            ));
        }
        if filters.low_stock == Some(true) {
            where_clauses.push("i.quantity <= p.min_stock AND p.min_stock > 0".to_string());
        }

        let where_sql = where_clauses.join(" AND ");
        let from_sql = "inventory i \
                        JOIN products p ON i.product_id = p.id \
                        JOIN locations l ON i.location_id = l.id";

        // Count query
        let count_sql = format!("SELECT COUNT(*) FROM {from_sql} WHERE {where_sql}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        if let Some(wid) = filters.warehouse_id {
            count_query = count_query.bind(wid);
        }
        if let Some(lid) = filters.location_id {
            count_query = count_query.bind(lid);
        }
        if let Some(pid) = filters.product_id {
            count_query = count_query.bind(pid);
        }
        if let Some(ref s) = filters.search {
            count_query = count_query.bind(s);
        }

        let total = count_query
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?
            .0;

        // Data query
        idx += 1;
        let limit_idx = idx;
        idx += 1;
        let offset_idx = idx;

        let data_sql = format!(
            "SELECT {INVENTORY_ITEM_SELECT} FROM {from_sql} \
             WHERE {where_sql} \
             ORDER BY p.name ASC, l.name ASC \
             LIMIT ${limit_idx} OFFSET ${offset_idx}"
        );
        let mut data_query = sqlx::query_as::<_, InventoryItemRow>(&data_sql);
        if let Some(wid) = filters.warehouse_id {
            data_query = data_query.bind(wid);
        }
        if let Some(lid) = filters.location_id {
            data_query = data_query.bind(lid);
        }
        if let Some(pid) = filters.product_id {
            data_query = data_query.bind(pid);
        }
        if let Some(ref s) = filters.search {
            data_query = data_query.bind(s);
        }
        data_query = data_query.bind(limit).bind(offset);

        let rows = data_query
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
    }

    // ── get_product_stock ───────────────────────────────────────────

    async fn get_product_stock(
        &self,
        product_id: Uuid,
    ) -> Result<Vec<InventoryItem>, DomainError> {
        let sql = format!(
            "SELECT {INVENTORY_ITEM_SELECT} \
             FROM inventory i \
             JOIN products p ON i.product_id = p.id \
             JOIN locations l ON i.location_id = l.id \
             WHERE p.deleted_at IS NULL AND i.product_id = $1 \
             ORDER BY l.name ASC"
        );
        let rows = sqlx::query_as::<_, InventoryItemRow>(&sql)
            .bind(product_id)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    // ── get_location_stock ──────────────────────────────────────────

    async fn get_location_stock(
        &self,
        location_id: Uuid,
    ) -> Result<Vec<InventoryItem>, DomainError> {
        let sql = format!(
            "SELECT {INVENTORY_ITEM_SELECT} \
             FROM inventory i \
             JOIN products p ON i.product_id = p.id \
             JOIN locations l ON i.location_id = l.id \
             WHERE p.deleted_at IS NULL AND i.location_id = $1 \
             ORDER BY p.name ASC"
        );
        let rows = sqlx::query_as::<_, InventoryItemRow>(&sql)
            .bind(location_id)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(Into::into).collect())
    }
}

// ── Opening balance (admin-only initial-load entry) ────────────────
//
// Registers pre-existing stock directly at a non-Reception location without
// going through the standard receive→distribute flow. Intended for one-off
// migration imports (e.g., customer already has inventory on the shelf when
// they onboard) — invoked via curl/CLI by `superadmin`/`owner` roles.
//
// Atomic: validates the location belongs to the warehouse and is NOT a
// Reception, optionally upserts `product_lots` + `inventory_lots` when a lot
// number is supplied, upserts `inventory`, and writes a movement with
// `movement_type='entry'` and `movement_reason='initial_load'`.
#[allow(clippy::too_many_arguments)]
pub async fn opening_balance(
    pool: &PgPool,
    product_id: Uuid,
    warehouse_id: Uuid,
    location_id: Uuid,
    quantity: f64,
    lot_number: Option<&str>,
    batch_date: Option<NaiveDate>,
    expiration_date: Option<NaiveDate>,
    supplier_id: Option<Uuid>,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<(), DomainError> {
    if quantity <= 0.0 {
        return Err(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        ));
    }

    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // Validate: target location exists, belongs to warehouse, and is NOT a
    // Reception. Opening balance MUST bypass the receive flow, so landing at
    // Reception would produce a misleading audit trail.
    let loc = sqlx::query_as::<_, (Uuid, LocationType)>(
        "SELECT warehouse_id, location_type FROM locations WHERE id = $1",
    )
    .bind(location_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Location not found".to_string()))?;

    if loc.0 != warehouse_id {
        return Err(DomainError::Validation(
            "Location does not belong to warehouse".to_string(),
        ));
    }
    if matches!(loc.1, LocationType::Reception) {
        return Err(DomainError::Validation(
            "Opening balance cannot target a Reception location".to_string(),
        ));
    }

    // Optional lot-tracked path: upsert product_lots, increment received_qty,
    // upsert inventory_lots at the target location.
    if let Some(ln) = lot_number {
        let row = sqlx::query_as::<_, (Uuid,)>(
            r#"
            INSERT INTO product_lots
                (product_id, lot_number, batch_date, expiration_date, supplier_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (product_id, lot_number) DO UPDATE SET updated_at = NOW()
            RETURNING id
            "#,
        )
        .bind(product_id)
        .bind(ln)
        .bind(batch_date)
        .bind(expiration_date)
        .bind(supplier_id)
        .bind(notes)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            "UPDATE product_lots \
             SET received_quantity = received_quantity + $2 \
             WHERE id = $1",
        )
        .bind(row.0)
        .bind(quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            r#"
            INSERT INTO inventory_lots (product_lot_id, location_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_lot_id, location_id)
            DO UPDATE SET quantity = inventory_lots.quantity + $3, updated_at = NOW()
            "#,
        )
        .bind(row.0)
        .bind(location_id)
        .bind(quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    // Upsert the main inventory row at the target location.
    sqlx::query(
        "INSERT INTO inventory (product_id, location_id, quantity) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (product_id, location_id) \
         DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
    )
    .bind(product_id)
    .bind(location_id)
    .bind(quantity)
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    // Stamp the audit movement. `initial_load` is the canonical reason tag
    // valuation/KPI pipelines key off to exclude one-off imports from
    // receive-throughput metrics.
    sqlx::query(
        r#"
        INSERT INTO movements
            (product_id, from_location_id, to_location_id, quantity,
             movement_type, user_id, supplier_id, reference, notes, movement_reason)
        VALUES ($1, NULL, $2, $3, 'entry', $4, $5, $6, $7, 'initial_load')
        "#,
    )
    .bind(product_id)
    .bind(location_id)
    .bind(quantity)
    .bind(user_id)
    .bind(supplier_id)
    .bind(lot_number)
    .bind(notes)
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(())
}

// ── FEFO consumption helper (work-orders-and-bom design §6c) ─────────
//
// `pick_for_consumption` is the single choke-point used by
// `work_orders_repo::complete` to back-flush materials at COMPLETE time. It
// is shared by any future flow that needs FEFO consumption against a
// lot-tracked + direct-inventory mixed stock.
//
// Ordering — FEFO: earliest `expiration_date` first, `NULLS LAST`, ties broken
// by `product_lots.created_at ASC`, then by `inventory_lots.id ASC` as the
// final deterministic tiebreak. Greedy fills the requested `quantity` from
// lots first, then falls through to the direct (non-lot) `inventory` row.
//
// Critical accounting rule (design §6c "critical note"): the `inventory` row
// is the SUM of lot-backed + direct quantity at that (product, location). So
// when we fall through to direct inventory we MUST subtract the lot-backed
// sum we already picked from the inventory row's total to avoid
// double-counting.
//
// Locking: issues `SELECT ... FOR UPDATE` on both `inventory_lots` and
// `inventory` so the caller's tx holds row locks until commit. The tx is
// passed in (not owned) because the caller (complete) has other work in the
// same tx that must be atomic with the pick plan.

/// One unit of FEFO back-flush draw. `lot_id`/`product_lot_id` carry the lot
/// identity when the pick came from an `inventory_lots` row; both are `None`
/// when the pick came from the direct (non-lot) `inventory` row.
#[derive(Debug, Clone)]
pub struct LotPick {
    /// `inventory_lots.id` for the decremented row. `None` means a direct
    /// (non-lot) inventory draw — the caller's replay only touches
    /// `inventory` for those picks.
    pub lot_id: Option<Uuid>,
    /// `product_lots.id` — carried out so the caller can write this into the
    /// back-flush movement row (for traceability).
    pub product_lot_id: Option<Uuid>,
    /// Units drawn for this pick. Sum across a `Full` outcome equals the
    /// requested `quantity`.
    pub quantity: f64,
}

/// Outcome of a `pick_for_consumption` dry-run. `Full` means the greedy plan
/// satisfied the entire request; `Short` means the request exceeds the total
/// available (lots + direct) at this (product, location) and the caller MUST
/// treat the WO as insufficient-stock. In neither case does this function
/// mutate inventory — the caller replays the plan from `Full(picks)` under
/// the same transaction to actually decrement.
#[derive(Debug, Clone)]
pub enum PickOutcome {
    Full(Vec<LotPick>),
    Short {
        picks: Vec<LotPick>,
        shortfall: f64,
    },
}

/// FEFO-greedy consumption plan for `(product_id, location_id)` totalling
/// `quantity`. Runs inside the caller's transaction; takes row locks via
/// `FOR UPDATE` so the caller retains serializability across the eventual
/// execute phase. DOES NOT mutate inventory.
///
/// See design §6c for the full ordering + accounting contract.
pub async fn pick_for_consumption(
    tx: &mut Transaction<'_, Postgres>,
    product_id: Uuid,
    location_id: Uuid,
    quantity: f64,
) -> Result<PickOutcome, DomainError> {
    if quantity <= 0.0 {
        // Degenerate input — return a trivially full plan so callers can
        // treat zero-quantity BOM rows uniformly without a special case.
        return Ok(PickOutcome::Full(Vec::new()));
    }

    // Step 1: FEFO-order `inventory_lots` at the location for this product.
    // `quantity > 0` filter skips already-depleted lot rows. `FOR UPDATE` on
    // both the `il` alias (the mutable target) keeps the caller's tx
    // serializable against concurrent picks.
    //
    // `_exp` and `_created_at` are carried only for the ORDER BY side-effect
    // (Postgres requires the sort key columns to be in the projection when
    // `DISTINCT` is used — we're not using DISTINCT here, but pulling them
    // out keeps the code future-proof if the query ever gains grouping).
    let lot_rows: Vec<(Uuid, Uuid, f64, Option<NaiveDate>, DateTime<Utc>)> = sqlx::query_as(
        r#"
        SELECT il.id, pl.id, il.quantity::float8, pl.expiration_date, pl.created_at
        FROM inventory_lots il
        JOIN product_lots pl ON pl.id = il.product_lot_id
        WHERE il.location_id = $2 AND pl.product_id = $1 AND il.quantity > 0
        ORDER BY pl.expiration_date NULLS LAST, pl.created_at ASC, il.id ASC
        FOR UPDATE OF il
        "#,
    )
    .bind(product_id)
    .bind(location_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(map_sqlx_error)?;

    let mut picks: Vec<LotPick> = Vec::new();
    let mut remaining = quantity;

    for (il_id, pl_id, il_qty, _exp, _created_at) in lot_rows {
        if remaining <= 0.0 {
            break;
        }
        let take = remaining.min(il_qty);
        if take > 0.0 {
            picks.push(LotPick {
                lot_id: Some(il_id),
                product_lot_id: Some(pl_id),
                quantity: take,
            });
            remaining -= take;
        }
    }

    // Step 2: fall through to the direct (non-lot) inventory row if still
    // short. The lot-backed sum picked in Step 1 has already been attributed
    // to the `inventory` row's total (see "critical accounting rule" above),
    // so the non-lot availability = `inventory.quantity - sum(picks)`.
    if remaining > 0.0 {
        let direct: Option<(f64,)> = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
        )
        .bind(product_id)
        .bind(location_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(map_sqlx_error)?;

        if let Some((qty,)) = direct {
            let lot_sum: f64 = picks.iter().map(|p| p.quantity).sum();
            let non_lot_available = (qty - lot_sum).max(0.0);
            let take = remaining.min(non_lot_available);
            if take > 0.0 {
                picks.push(LotPick {
                    lot_id: None,
                    product_lot_id: None,
                    quantity: take,
                });
                remaining -= take;
            }
        }
    }

    if remaining > 0.0 {
        Ok(PickOutcome::Short {
            picks,
            shortfall: remaining,
        })
    } else {
        Ok(PickOutcome::Full(picks))
    }
}
