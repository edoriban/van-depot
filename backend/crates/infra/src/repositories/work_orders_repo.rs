// Work Orders repository — implements the `WorkOrderRepository` trait from
// `vandepot_domain::ports::work_order_repository`. Mirrors the structure of
// `purchase_order_repo.rs` (header + lines) but adds the state-transition
// actions `issue` / `complete` / `cancel` per design §3a–d and §6b.
//
// Every action runs in a single transaction. Guard violations short-circuit
// with a typed `DomainError`, leaving zero rows written.
//
// Atomicity for `complete` — the hardest action — is split into two phases:
//   1. DRY RUN: per material, `pick_for_consumption` returns a plan. If ANY
//      material is `Short`, accumulate `MissingMaterial` and return
//      `InsufficientWorkOrderStock { missing }`. The tx rolls back, so zero
//      rows change.
//   2. EXECUTE: only after the dry run passed, replay each pick plan to
//      decrement inventory/inventory_lots, emit back-flush movements, create
//      the FG lot, stamp the production_output entry movement, and flip
//      status to `completed`.
// Never interleave these phases (design flag).

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use vandepot_domain::error::{DomainError, MissingMaterial};
use vandepot_domain::models::enums::{LocationType, ProductClass, WorkOrderStatus};
use vandepot_domain::models::work_order::{WorkOrder, WorkOrderMaterial};
use vandepot_domain::ports::work_order_repository::{
    CancelResult, CompleteResult, CreateWorkOrderParams, IssueResult, MaterialSourceOverride,
    WorkOrderFilters, WorkOrderRepository,
};

use super::inventory_repo::{pick_for_consumption, LotPick, PickOutcome};
use super::shared::map_sqlx_error;

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct WorkOrderRow {
    id: Uuid,
    code: String,
    recipe_id: Uuid,
    fg_product_id: Uuid,
    fg_quantity: f64,
    status: WorkOrderStatus,
    warehouse_id: Uuid,
    work_center_location_id: Uuid,
    notes: Option<String>,
    created_by: Uuid,
    created_at: DateTime<Utc>,
    issued_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    cancelled_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl From<WorkOrderRow> for WorkOrder {
    fn from(row: WorkOrderRow) -> Self {
        WorkOrder {
            id: row.id,
            code: row.code,
            recipe_id: row.recipe_id,
            fg_product_id: row.fg_product_id,
            fg_quantity: row.fg_quantity,
            status: row.status,
            warehouse_id: row.warehouse_id,
            work_center_location_id: row.work_center_location_id,
            notes: row.notes,
            created_by: row.created_by,
            created_at: row.created_at,
            issued_at: row.issued_at,
            completed_at: row.completed_at,
            cancelled_at: row.cancelled_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct WorkOrderMaterialRow {
    id: Uuid,
    work_order_id: Uuid,
    product_id: Uuid,
    product_name: Option<String>,
    product_sku: Option<String>,
    quantity_expected: f64,
    quantity_consumed: f64,
    notes: Option<String>,
}

impl From<WorkOrderMaterialRow> for WorkOrderMaterial {
    fn from(row: WorkOrderMaterialRow) -> Self {
        WorkOrderMaterial {
            id: row.id,
            work_order_id: row.work_order_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            quantity_expected: row.quantity_expected,
            quantity_consumed: row.quantity_consumed,
            notes: row.notes,
        }
    }
}

// Selected columns for WorkOrder reads. Cast DECIMAL → float8 so the
// sqlx::FromRow deserializer sees a compatible Rust type (project convention
// — every other numeric col uses the same `::float8` trick).
const WO_COLUMNS: &str = r#"
    id, code, recipe_id, fg_product_id,
    fg_quantity::float8 AS fg_quantity,
    status, warehouse_id, work_center_location_id,
    notes, created_by, created_at,
    issued_at, completed_at, cancelled_at,
    updated_at, deleted_at
"#;

// ── Repository ───────────────────────────────────────────────────────

pub struct PgWorkOrderRepository {
    pub pool: PgPool,
}

impl PgWorkOrderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Generate a WO code `WO-YYYYMMDD-<6-upper-hex-of-uuid>`. Collision chance
/// with 16^6 = 16.7M combinations per day is astronomically low; the UNIQUE
/// constraint on `work_orders.code` is the backstop.
fn generate_wo_code(id: Uuid) -> String {
    let today = Utc::now().format("%Y%m%d");
    let hex = id.simple().to_string();
    // Take the first 6 hex chars and upper-case them.
    let short: String = hex.chars().take(6).collect::<String>().to_uppercase();
    format!("WO-{today}-{short}")
}

/// Resolve the finished-good location for a warehouse inside a tx. Returns
/// Conflict if no such row exists (data-integrity — should never happen
/// post-migration 3 backfill).
async fn find_finished_good_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    warehouse_id: Uuid,
) -> Result<Uuid, DomainError> {
    sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM locations \
         WHERE warehouse_id = $1 AND location_type = 'finished_good' AND is_system = true \
         LIMIT 1",
    )
    .bind(warehouse_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(map_sqlx_error)?
    .map(|r| r.0)
    .ok_or_else(|| {
        DomainError::Conflict(
            "Warehouse has no finished_good location — data integrity error".to_string(),
        )
    })
}

/// Auto-pick a source location for a material when the caller omitted an
/// override. Deterministic: highest-quantity location in the same warehouse
/// that is NOT of type reception/work_center/finished_good, ties broken by
/// `locations.created_at ASC`. Returns `None` when no location has any
/// inventory of the product.
async fn auto_pick_source_location(
    tx: &mut Transaction<'_, Postgres>,
    warehouse_id: Uuid,
    product_id: Uuid,
) -> Result<Option<Uuid>, DomainError> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT l.id
        FROM inventory i
        JOIN locations l ON l.id = i.location_id
        WHERE l.warehouse_id = $1
          AND i.product_id = $2
          AND i.quantity > 0
          AND l.location_type NOT IN ('reception', 'work_center', 'finished_good')
        ORDER BY i.quantity DESC, l.created_at ASC
        LIMIT 1
        "#,
    )
    .bind(warehouse_id)
    .bind(product_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.map(|r| r.0))
}

// ── Trait impl ───────────────────────────────────────────────────────

#[async_trait]
impl WorkOrderRepository for PgWorkOrderRepository {
    async fn list(
        &self,
        filters: WorkOrderFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<WorkOrder>, i64), DomainError> {
        let mut where_clauses: Vec<String> = vec!["wo.deleted_at IS NULL".to_string()];
        let mut idx: usize = 0;

        if filters.status.is_some() {
            idx += 1;
            where_clauses.push(format!("wo.status = ${idx}"));
        }
        if filters.warehouse_id.is_some() {
            idx += 1;
            where_clauses.push(format!("wo.warehouse_id = ${idx}"));
        }
        if filters.work_center_location_id.is_some() {
            idx += 1;
            where_clauses.push(format!("wo.work_center_location_id = ${idx}"));
        }
        if filters.search.is_some() {
            idx += 1;
            where_clauses.push(format!(
                "(wo.code ILIKE '%' || ${idx} || '%' OR p.name ILIKE '%' || ${idx} || '%')"
            ));
        }

        let where_sql = where_clauses.join(" AND ");
        let from_sql = "work_orders wo LEFT JOIN products p ON p.id = wo.fg_product_id";

        let count_sql = format!("SELECT COUNT(*) FROM {from_sql} WHERE {where_sql}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        if let Some(ref st) = filters.status {
            count_query = count_query.bind(st);
        }
        if let Some(wid) = filters.warehouse_id {
            count_query = count_query.bind(wid);
        }
        if let Some(wcid) = filters.work_center_location_id {
            count_query = count_query.bind(wcid);
        }
        if let Some(ref s) = filters.search {
            count_query = count_query.bind(s);
        }
        let total = count_query
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?
            .0;

        idx += 1;
        let limit_idx = idx;
        idx += 1;
        let offset_idx = idx;

        let data_sql = format!(
            "SELECT wo.id, wo.code, wo.recipe_id, wo.fg_product_id, \
                    wo.fg_quantity::float8 AS fg_quantity, \
                    wo.status, wo.warehouse_id, wo.work_center_location_id, \
                    wo.notes, wo.created_by, wo.created_at, \
                    wo.issued_at, wo.completed_at, wo.cancelled_at, \
                    wo.updated_at, wo.deleted_at \
             FROM {from_sql} \
             WHERE {where_sql} \
             ORDER BY wo.created_at DESC \
             LIMIT ${limit_idx} OFFSET ${offset_idx}"
        );
        let mut data_query = sqlx::query_as::<_, WorkOrderRow>(&data_sql);
        if let Some(ref st) = filters.status {
            data_query = data_query.bind(st);
        }
        if let Some(wid) = filters.warehouse_id {
            data_query = data_query.bind(wid);
        }
        if let Some(wcid) = filters.work_center_location_id {
            data_query = data_query.bind(wcid);
        }
        if let Some(ref s) = filters.search {
            data_query = data_query.bind(s);
        }
        data_query = data_query.bind(limit).bind(offset);

        let rows = data_query
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(WorkOrder::from).collect(), total))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<WorkOrder>, DomainError> {
        let sql = format!(
            "SELECT {WO_COLUMNS} FROM work_orders WHERE id = $1 AND deleted_at IS NULL"
        );
        let row = sqlx::query_as::<_, WorkOrderRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(WorkOrder::from))
    }

    async fn list_materials(
        &self,
        work_order_id: Uuid,
    ) -> Result<Vec<WorkOrderMaterial>, DomainError> {
        let rows = sqlx::query_as::<_, WorkOrderMaterialRow>(
            r#"
            SELECT wom.id, wom.work_order_id, wom.product_id,
                   p.name AS product_name, p.sku AS product_sku,
                   wom.quantity_expected::float8 AS quantity_expected,
                   wom.quantity_consumed::float8 AS quantity_consumed,
                   wom.notes
            FROM work_order_materials wom
            LEFT JOIN products p ON p.id = wom.product_id
            WHERE wom.work_order_id = $1
            ORDER BY p.name ASC, wom.id ASC
            "#,
        )
        .bind(work_order_id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(WorkOrderMaterial::from).collect())
    }

    async fn create(&self, params: CreateWorkOrderParams) -> Result<WorkOrder, DomainError> {
        // fg_quantity > 0 is also enforced by the DB CHECK, but surfacing a
        // typed Validation here keeps the error shape consistent with the
        // rest of the repo.
        if params.fg_quantity <= 0.0 {
            return Err(DomainError::Validation(
                "fg_quantity must be greater than 0".to_string(),
            ));
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Guard 1: FG product exists + is raw_material + is_manufactured=true.
        let fg_row: Option<(ProductClass, bool)> = sqlx::query_as(
            "SELECT product_class, is_manufactured \
             FROM products WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(params.fg_product_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let (fg_class, fg_is_manufactured) = fg_row
            .ok_or_else(|| DomainError::NotFound("FG product not found".to_string()))?;

        if !fg_is_manufactured || !matches!(fg_class, ProductClass::RawMaterial) {
            return Err(DomainError::WorkOrderFgProductNotManufactured {
                product_id: params.fg_product_id,
            });
        }

        // Guard 2: warehouse has ≥1 work_center location.
        let wc_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM locations \
             WHERE warehouse_id = $1 AND location_type = 'work_center'",
        )
        .bind(params.warehouse_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        if wc_count.0 == 0 {
            return Err(DomainError::WorkOrderWarehouseHasNoWorkCenter {
                warehouse_id: params.warehouse_id,
            });
        }

        // Guard 3: selected work_center belongs to the warehouse AND has
        // type='work_center'.
        let wc_loc: Option<(Uuid, LocationType)> = sqlx::query_as(
            "SELECT warehouse_id, location_type FROM locations WHERE id = $1",
        )
        .bind(params.work_center_location_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        match wc_loc {
            None => {
                return Err(DomainError::NotFound(
                    "Work center location not found".to_string(),
                ));
            }
            Some((wh, LocationType::WorkCenter)) if wh == params.warehouse_id => {}
            Some(_) => {
                return Err(DomainError::Validation(
                    "Selected location is not a work_center of the target warehouse".to_string(),
                ));
            }
        }

        // Guard 4: recipe exists + no item has product_class='tool_spare'.
        let recipe_exists: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM recipes WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(params.recipe_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        if recipe_exists.is_none() {
            return Err(DomainError::NotFound("Recipe not found".to_string()));
        }

        let recipe_items: Vec<(Uuid, f64, Option<String>, ProductClass)> = sqlx::query_as(
            r#"
            SELECT ri.product_id, ri.quantity::float8, ri.notes, p.product_class
            FROM recipe_items ri
            JOIN products p ON p.id = ri.product_id
            WHERE ri.recipe_id = $1
            ORDER BY p.name ASC
            "#,
        )
        .bind(params.recipe_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let offenders: Vec<Uuid> = recipe_items
            .iter()
            .filter(|(_, _, _, class)| matches!(class, ProductClass::ToolSpare))
            .map(|(pid, _, _, _)| *pid)
            .collect();
        if !offenders.is_empty() {
            return Err(DomainError::WorkOrderBomIncludesToolSpare {
                offending_product_ids: offenders,
            });
        }

        // Pre-generate the UUID so we can generate the code from it BEFORE
        // INSERT (the code is a NOT-NULL column, can't be filled post-hoc).
        let wo_id = Uuid::new_v4();
        let code = generate_wo_code(wo_id);

        let row = sqlx::query_as::<_, WorkOrderRow>(
            r#"
            INSERT INTO work_orders
                (id, code, recipe_id, fg_product_id, fg_quantity,
                 status, warehouse_id, work_center_location_id, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9)
            RETURNING id, code, recipe_id, fg_product_id,
                      fg_quantity::float8 AS fg_quantity,
                      status, warehouse_id, work_center_location_id,
                      notes, created_by, created_at, issued_at, completed_at,
                      cancelled_at, updated_at, deleted_at
            "#,
        )
        .bind(wo_id)
        .bind(&code)
        .bind(params.recipe_id)
        .bind(params.fg_product_id)
        .bind(params.fg_quantity)
        .bind(params.warehouse_id)
        .bind(params.work_center_location_id)
        .bind(params.notes.as_deref())
        .bind(params.created_by)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Snapshot the BOM: one row per recipe item.
        for (product_id, quantity, notes, _class) in &recipe_items {
            sqlx::query(
                "INSERT INTO work_order_materials \
                    (work_order_id, product_id, quantity_expected, notes) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(wo_id)
            .bind(product_id)
            .bind(*quantity)
            .bind(notes.as_deref())
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(WorkOrder::from(row))
    }

    async fn issue(
        &self,
        id: Uuid,
        user_id: Uuid,
        overrides: Vec<MaterialSourceOverride>,
    ) -> Result<IssueResult, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Lock + validate state.
        let wo: Option<WorkOrderRow> = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "SELECT {WO_COLUMNS} FROM work_orders \
             WHERE id = $1 AND deleted_at IS NULL FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let wo = wo.ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;
        if !matches!(wo.status, WorkOrderStatus::Draft) {
            return Err(DomainError::WorkOrderInvalidTransition {
                from: wo.status,
                to: WorkOrderStatus::InProgress,
            });
        }

        // Fetch materials once.
        let materials: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
            "SELECT id, product_id, quantity_expected::float8 \
             FROM work_order_materials WHERE work_order_id = $1 \
             ORDER BY id ASC",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let mut movement_ids: Vec<Uuid> = Vec::with_capacity(materials.len());

        for (_wom_id, product_id, quantity) in materials {
            // Resolve source: operator override > auto-pick.
            let source = overrides
                .iter()
                .find(|o| o.product_id == product_id)
                .map(|o| o.from_location_id);

            let from_location_id = match source {
                Some(s) => s,
                None => auto_pick_source_location(&mut tx, wo.warehouse_id, product_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::Validation(format!(
                            "No source location with stock of product {product_id} in warehouse"
                        ))
                    })?,
            };

            // Check stock at source (shared idiom — INSERT movement directly
            // here instead of calling record_transfer() because the latter
            // emits its own tx, and we need everything in one tx with the
            // final status UPDATE). This mirrors `recipes_repo::dispatch_recipe`.
            let source_qty: (f64,) = sqlx::query_as(
                "SELECT quantity::float8 FROM inventory \
                 WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
            )
            .bind(product_id)
            .bind(from_location_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_sqlx_error)?
            .unwrap_or((0.0,));

            if source_qty.0 < quantity {
                return Err(DomainError::Validation(format!(
                    "Insufficient stock at source location for product {product_id}: available {}, required {}",
                    source_qty.0, quantity
                )));
            }

            // Decrement source, upsert destination (work-center).
            sqlx::query(
                "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
                 WHERE product_id = $1 AND location_id = $2",
            )
            .bind(product_id)
            .bind(from_location_id)
            .bind(quantity)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

            sqlx::query(
                "INSERT INTO inventory (product_id, location_id, quantity) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (product_id, location_id) \
                 DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
            )
            .bind(product_id)
            .bind(wo.work_center_location_id)
            .bind(quantity)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

            // Emit transfer movement with WO linkage.
            let mv_id: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO movements
                    (product_id, from_location_id, to_location_id, quantity,
                     movement_type, user_id, movement_reason, work_order_id)
                VALUES ($1, $2, $3, $4, 'transfer', $5, 'wo_issue', $6)
                RETURNING id
                "#,
            )
            .bind(product_id)
            .bind(from_location_id)
            .bind(wo.work_center_location_id)
            .bind(quantity)
            .bind(user_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

            movement_ids.push(mv_id.0);
        }

        // Flip status.
        let updated = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "UPDATE work_orders \
                SET status = 'in_progress', issued_at = NOW(), updated_at = NOW() \
              WHERE id = $1 \
              RETURNING {WO_COLUMNS}"
        ))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(IssueResult {
            work_order: WorkOrder::from(updated),
            movement_ids,
        })
    }

    async fn complete(
        &self,
        id: Uuid,
        user_id: Uuid,
        fg_expiration_date: Option<NaiveDate>,
    ) -> Result<CompleteResult, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Lock + validate state.
        let wo: WorkOrderRow = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "SELECT {WO_COLUMNS} FROM work_orders \
             WHERE id = $1 AND deleted_at IS NULL FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;

        if !matches!(wo.status, WorkOrderStatus::InProgress) {
            return Err(DomainError::WorkOrderInvalidTransition {
                from: wo.status,
                to: WorkOrderStatus::Completed,
            });
        }

        // Load FG product flags (has_expiry controls whether the operator's
        // supplied expiration date is honored or zeroed).
        let fg_has_expiry: (bool,) = sqlx::query_as(
            "SELECT has_expiry FROM products WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(wo.fg_product_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let materials: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
            "SELECT id, product_id, quantity_expected::float8 \
             FROM work_order_materials WHERE work_order_id = $1 \
             ORDER BY id ASC",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // ── DRY-RUN PHASE ──
        // For each material, compute the pick plan. Accumulate any shortfalls.
        // NOTE: pick_for_consumption takes `FOR UPDATE` locks on the affected
        // inventory_lots and inventory rows. Those locks are held until commit
        // or rollback of `tx`, so the subsequent EXECUTE phase sees a
        // consistent snapshot.
        let mut plans: Vec<(Uuid, Uuid, f64, Vec<LotPick>)> = Vec::with_capacity(materials.len());
        let mut missing: Vec<MissingMaterial> = Vec::new();

        for (wom_id, product_id, expected) in &materials {
            let outcome = pick_for_consumption(
                &mut tx,
                *product_id,
                wo.work_center_location_id,
                *expected,
            )
            .await?;
            match outcome {
                PickOutcome::Full(picks) => {
                    plans.push((*wom_id, *product_id, *expected, picks));
                }
                PickOutcome::Short { picks, shortfall } => {
                    let available: f64 = picks.iter().map(|p| p.quantity).sum();
                    missing.push(MissingMaterial {
                        product_id: *product_id,
                        expected: *expected,
                        available,
                        shortfall,
                    });
                }
            }
        }

        if !missing.is_empty() {
            // Rolling back the tx ensures zero rows changed (pick_for_consumption
            // only read + locked; it didn't mutate). Returning Err drops `tx`
            // which implicitly rolls back — we make it explicit for clarity.
            tx.rollback().await.map_err(map_sqlx_error)?;
            return Err(DomainError::InsufficientWorkOrderStock { missing });
        }

        // ── EXECUTE PHASE ──
        // Only reached when every material has a `Full` plan. Replay each
        // pick plan to decrement inventory_lots (if lot-backed) and inventory
        // (always, per the §6c accounting rule), then emit one exit movement
        // per material with movement_reason='back_flush'.
        let mut consumed_movement_ids: Vec<Uuid> = Vec::with_capacity(plans.len());

        for (wom_id, product_id, expected, picks) in plans {
            for pick in &picks {
                // Decrement inventory_lots for lot-backed picks.
                if let Some(il_id) = pick.lot_id {
                    // DELETE-if-zero mirrors lots_repo::perform_transfer_in_tx
                    // to keep the inventory_lots row count tidy. Using a
                    // CASE so we don't need to re-fetch the row.
                    sqlx::query(
                        "UPDATE inventory_lots \
                            SET quantity = quantity - $2, updated_at = NOW() \
                          WHERE id = $1",
                    )
                    .bind(il_id)
                    .bind(pick.quantity)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_error)?;

                    // Clean up rows that dropped to zero (keeps the FEFO
                    // query fast; matches existing convention in
                    // lots_repo::perform_transfer_in_tx).
                    sqlx::query(
                        "DELETE FROM inventory_lots \
                         WHERE id = $1 AND quantity <= 0",
                    )
                    .bind(il_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_error)?;
                }
            }

            // Single `inventory` decrement per material for the TOTAL picked
            // (lot-backed picks + direct picks). Per §6c the `inventory` row
            // is the sum of lot-backed + direct, so we always decrement it
            // by the full expected quantity.
            sqlx::query(
                "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
                 WHERE product_id = $1 AND location_id = $2",
            )
            .bind(product_id)
            .bind(wo.work_center_location_id)
            .bind(expected)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

            // Emit one back_flush exit movement per material. Design gave
            // implementation freedom between "one movement per material" and
            // "one movement per lot drawn" — we pick the former (spec §5
            // Implementation freedom note permits it) so each material line
            // has exactly one movement row, keeping the movements-per-WO
            // count predictable (N materials → N back_flush rows).
            let mv_id: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO movements
                    (product_id, from_location_id, to_location_id, quantity,
                     movement_type, user_id, movement_reason, work_order_id)
                VALUES ($1, $2, NULL, $3, 'exit', $4, 'back_flush', $5)
                RETURNING id
                "#,
            )
            .bind(product_id)
            .bind(wo.work_center_location_id)
            .bind(expected)
            .bind(user_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
            consumed_movement_ids.push(mv_id.0);

            // Update quantity_consumed on the snapshot row.
            sqlx::query(
                "UPDATE work_order_materials \
                    SET quantity_consumed = quantity_expected \
                  WHERE id = $1",
            )
            .bind(wom_id)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        // Create the FG lot + inventory_lots + inventory + production_output
        // movement.
        let fg_location_id = find_finished_good_in_tx(&mut tx, wo.warehouse_id).await?;
        let lot_number = format!("WO-{}-{}", wo.code, Utc::now().format("%Y%m%d"));
        // Honor operator-supplied expiration only when FG.has_expiry=true
        // (spec §4 has_expiry scenarios).
        let effective_exp = if fg_has_expiry.0 {
            fg_expiration_date
        } else {
            None
        };
        let batch_date = Utc::now().date_naive();

        let fg_lot_id: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO product_lots
                (product_id, lot_number, batch_date, expiration_date,
                 received_quantity, quality_status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
            RETURNING id
            "#,
        )
        .bind(wo.fg_product_id)
        .bind(&lot_number)
        .bind(batch_date)
        .bind(effective_exp)
        .bind(wo.fg_quantity)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            "INSERT INTO inventory_lots (product_lot_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_lot_id, location_id) \
             DO UPDATE SET quantity = inventory_lots.quantity + $3, updated_at = NOW()",
        )
        .bind(fg_lot_id.0)
        .bind(fg_location_id)
        .bind(wo.fg_quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(wo.fg_product_id)
        .bind(fg_location_id)
        .bind(wo.fg_quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Stamp the production_output entry movement. `reference` carries the
        // lot number as a human-readable pointer (matches lots_repo convention).
        let fg_mv_id: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO movements
                (product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, reference, movement_reason, work_order_id)
            VALUES ($1, NULL, $2, $3, 'entry', $4, $5, 'production_output', $6)
            RETURNING id
            "#,
        )
        .bind(wo.fg_product_id)
        .bind(fg_location_id)
        .bind(wo.fg_quantity)
        .bind(user_id)
        .bind(&lot_number)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let updated = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "UPDATE work_orders \
                SET status = 'completed', completed_at = NOW(), updated_at = NOW() \
              WHERE id = $1 \
              RETURNING {WO_COLUMNS}"
        ))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(CompleteResult {
            work_order: WorkOrder::from(updated),
            consumed_movement_ids,
            fg_lot_id: fg_lot_id.0,
            fg_movement_id: fg_mv_id.0,
        })
    }

    async fn cancel(&self, id: Uuid, user_id: Uuid) -> Result<CancelResult, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        let wo: WorkOrderRow = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "SELECT {WO_COLUMNS} FROM work_orders \
             WHERE id = $1 AND deleted_at IS NULL FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;

        let mut reversal_movement_ids: Vec<Uuid> = Vec::new();

        match wo.status {
            WorkOrderStatus::Draft => {
                // Nothing to reverse — just stamp cancelled_at.
            }
            WorkOrderStatus::InProgress => {
                // Find every wo_issue movement. For each, emit a mirrored
                // reverse transfer (product/quantity preserved, from/to
                // swapped, reason='wo_cancel_reversal').
                let issues: Vec<(Uuid, Uuid, Option<Uuid>, Option<Uuid>, f64)> = sqlx::query_as(
                    r#"
                    SELECT id, product_id, from_location_id, to_location_id, quantity::float8
                    FROM movements
                    WHERE work_order_id = $1 AND movement_reason = 'wo_issue'
                    ORDER BY created_at ASC
                    "#,
                )
                .bind(id)
                .fetch_all(&mut *tx)
                .await
                .map_err(map_sqlx_error)?;

                for (_issue_id, product_id, issue_from, issue_to, quantity) in issues {
                    let reverse_from = issue_to.ok_or_else(|| {
                        DomainError::Conflict(
                            "wo_issue movement missing to_location_id — data integrity error"
                                .to_string(),
                        )
                    })?;
                    let reverse_to = issue_from.ok_or_else(|| {
                        DomainError::Conflict(
                            "wo_issue movement missing from_location_id — data integrity error"
                                .to_string(),
                        )
                    })?;

                    // Decrement work-center, upsert original source.
                    sqlx::query(
                        "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
                         WHERE product_id = $1 AND location_id = $2",
                    )
                    .bind(product_id)
                    .bind(reverse_from)
                    .bind(quantity)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_error)?;

                    sqlx::query(
                        "INSERT INTO inventory (product_id, location_id, quantity) \
                         VALUES ($1, $2, $3) \
                         ON CONFLICT (product_id, location_id) \
                         DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
                    )
                    .bind(product_id)
                    .bind(reverse_to)
                    .bind(quantity)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_sqlx_error)?;

                    let mv_id: (Uuid,) = sqlx::query_as(
                        r#"
                        INSERT INTO movements
                            (product_id, from_location_id, to_location_id, quantity,
                             movement_type, user_id, movement_reason, work_order_id)
                        VALUES ($1, $2, $3, $4, 'transfer', $5, 'wo_cancel_reversal', $6)
                        RETURNING id
                        "#,
                    )
                    .bind(product_id)
                    .bind(reverse_from)
                    .bind(reverse_to)
                    .bind(quantity)
                    .bind(user_id)
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(map_sqlx_error)?;
                    reversal_movement_ids.push(mv_id.0);
                }
            }
            // Terminal states cannot be cancelled.
            status @ (WorkOrderStatus::Completed | WorkOrderStatus::Cancelled) => {
                return Err(DomainError::WorkOrderInvalidTransition {
                    from: status,
                    to: WorkOrderStatus::Cancelled,
                });
            }
        }

        let updated = sqlx::query_as::<_, WorkOrderRow>(&format!(
            "UPDATE work_orders \
                SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() \
              WHERE id = $1 \
              RETURNING {WO_COLUMNS}"
        ))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(CancelResult {
            work_order: WorkOrder::from(updated),
            reversal_movement_ids,
        })
    }
}
