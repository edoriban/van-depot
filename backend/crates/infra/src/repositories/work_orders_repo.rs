//! Work Orders repository — free functions.
//!
//! Phase B batch 5 (multi-tenant-foundation, design §5.4) collapsed the
//! struct-with-pool + trait shape into free functions, mirroring the
//! B1..B4 template. The trait+struct provided no testing/substitution
//! value once the executor became a connection reference.
//!
//! Signatures:
//!   * Read functions take `(&mut PgConnection, tenant_id, ...)`.
//!   * State-transition writes (create/issue/complete/cancel) begin
//!     their own tx and take `(&PgPool, tenant_id, ...)`.
//!
//! The B4 `fetch_warehouse_tenant_id` shim is GONE from this file
//! because tenant_id flows in as the function parameter. The shim
//! remains in `cycle_count_repo` (B7 territory).
//!
//! Atomicity for `complete` is split into DRY-RUN + EXECUTE phases per
//! design §6c — never interleave them.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N`. The
//! composite FKs installed by 20260508000005 reject any cross-tenant
//! INSERT/UPDATE at the DB layer; the predicate is belt-and-suspenders.
//!
//! Param structs (`CreateWorkOrderParams`, `IssueResult`, etc.) live
//! here now that the port file is retired (matching the B1..B4
//! pattern of pulling DTOs into the repo file when the trait dies).

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::{DomainError, MissingMaterial};
use vandepot_domain::models::enums::{LocationType, ProductClass, WorkOrderStatus};
use vandepot_domain::models::work_order::{WorkOrder, WorkOrderMaterial};

use super::inventory_repo::{pick_for_consumption, LotPick, PickOutcome};
use super::shared::map_sqlx_error;

// ── Public param/result structs ──────────────────────────────────────

/// Filter bag for `list`. Each field composes with AND; omitting all returns
/// the full non-deleted WO set within the tenant.
#[derive(Debug, Clone, Default)]
pub struct WorkOrderFilters {
    pub status: Option<WorkOrderStatus>,
    pub warehouse_id: Option<Uuid>,
    pub work_center_location_id: Option<Uuid>,
    /// Substring match against `code` or the FG product name (via JOIN).
    pub search: Option<String>,
}

/// Input for `create`. The repo builds the code + snapshots the BOM from the
/// referenced recipe in one transaction.
#[derive(Debug, Clone)]
pub struct CreateWorkOrderParams {
    pub recipe_id: Uuid,
    pub fg_product_id: Uuid,
    pub fg_quantity: f64,
    pub warehouse_id: Uuid,
    pub work_center_location_id: Uuid,
    pub notes: Option<String>,
    pub created_by: Uuid,
}

/// Optional operator-supplied source for a single material during `issue`.
#[derive(Debug, Clone)]
pub struct MaterialSourceOverride {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct IssueResult {
    pub work_order: WorkOrder,
    pub movement_ids: Vec<Uuid>,
}

#[derive(Debug, Clone)]
pub struct CompleteResult {
    pub work_order: WorkOrder,
    pub consumed_movement_ids: Vec<Uuid>,
    pub fg_lot_id: Uuid,
    pub fg_movement_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct CancelResult {
    pub work_order: WorkOrder,
    pub reversal_movement_ids: Vec<Uuid>,
}

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct WorkOrderRow {
    id: Uuid,
    tenant_id: Uuid,
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
            tenant_id: row.tenant_id,
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
    id, tenant_id, code, recipe_id, fg_product_id,
    fg_quantity::float8 AS fg_quantity,
    status, warehouse_id, work_center_location_id,
    notes, created_by, created_at,
    issued_at, completed_at, cancelled_at,
    updated_at, deleted_at
"#;

// ── Helpers ──────────────────────────────────────────────────────────

/// Generate a WO code `WO-YYYYMMDD-<6-upper-hex-of-uuid>`. Collision chance
/// with 16^6 = 16.7M combinations per day per tenant is astronomically low;
/// the `(tenant_id, code)` UNIQUE constraint is the backstop.
fn generate_wo_code(id: Uuid) -> String {
    let today = Utc::now().format("%Y%m%d");
    let hex = id.simple().to_string();
    let short: String = hex.chars().take(6).collect::<String>().to_uppercase();
    format!("WO-{today}-{short}")
}

/// Resolve the finished-good location for a warehouse inside a tx.
/// Tenant-scoped: only finds rows belonging to the supplied tenant_id.
async fn find_finished_good_in_tx(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Uuid, DomainError> {
    sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM locations \
         WHERE tenant_id = $1 \
           AND warehouse_id = $2 \
           AND location_type = 'finished_good' \
           AND is_system = true \
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .fetch_optional(&mut *conn)
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
/// inventory of the product. Tenant-scoped.
async fn auto_pick_source_location(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    product_id: Uuid,
) -> Result<Option<Uuid>, DomainError> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT l.id
        FROM inventory i
        JOIN locations l ON l.id = i.location_id AND l.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1
          AND l.warehouse_id = $2
          AND i.product_id = $3
          AND i.quantity > 0
          AND l.location_type NOT IN ('reception', 'work_center', 'finished_good')
        ORDER BY i.quantity DESC, l.created_at ASC
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .bind(product_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.map(|r| r.0))
}

// ── Queries ──────────────────────────────────────────────────────────

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    filters: WorkOrderFilters,
    limit: i64,
    offset: i64,
) -> Result<(Vec<WorkOrder>, i64), DomainError> {
    // First placeholder is always tenant_id; everything else shifts by one.
    let mut where_clauses: Vec<String> = vec![
        "wo.deleted_at IS NULL".to_string(),
        "wo.tenant_id = $1".to_string(),
    ];
    let mut idx: usize = 1;

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
    // Tenant-aligned join on products so the JOIN itself is tenant-scoped
    // (belt-and-suspenders with the composite FK on
    // work_orders(tenant_id, fg_product_id) → products(tenant_id, id)).
    let from_sql = "work_orders wo \
                    LEFT JOIN products p ON p.id = wo.fg_product_id AND p.tenant_id = wo.tenant_id";

    let count_sql = format!("SELECT COUNT(*) FROM {from_sql} WHERE {where_sql}");
    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql).bind(tenant_id);
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
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .0;

    idx += 1;
    let limit_idx = idx;
    idx += 1;
    let offset_idx = idx;

    let data_sql = format!(
        "SELECT wo.id, wo.tenant_id, wo.code, wo.recipe_id, wo.fg_product_id, \
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
    let mut data_query = sqlx::query_as::<_, WorkOrderRow>(&data_sql).bind(tenant_id);
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
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(WorkOrder::from).collect(), total))
}

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<WorkOrder>, DomainError> {
    let sql = format!(
        "SELECT {WO_COLUMNS} FROM work_orders \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL"
    );
    let row = sqlx::query_as::<_, WorkOrderRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(WorkOrder::from))
}

pub async fn list_materials(
    conn: &mut PgConnection,
    tenant_id: Uuid,
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
        LEFT JOIN products p ON p.id = wom.product_id AND p.tenant_id = wom.tenant_id
        WHERE wom.work_order_id = $1 AND wom.tenant_id = $2
        ORDER BY p.name ASC, wom.id ASC
        "#,
    )
    .bind(work_order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows.into_iter().map(WorkOrderMaterial::from).collect())
}

pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    params: CreateWorkOrderParams,
) -> Result<WorkOrder, DomainError> {
    // fg_quantity > 0 is also enforced by the DB CHECK, but surfacing a
    // typed Validation here keeps the error shape consistent with the
    // rest of the repo.
    if params.fg_quantity <= 0.0 {
        return Err(DomainError::Validation(
            "fg_quantity must be greater than 0".to_string(),
        ));
    }


    // Guard 1: FG product exists + is raw_material + is_manufactured=true.
    // Tenant-scoped probe.
    let fg_row: Option<(ProductClass, bool)> = sqlx::query_as(
        "SELECT product_class, is_manufactured \
         FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(params.fg_product_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let (fg_class, fg_is_manufactured) = fg_row
        .ok_or_else(|| DomainError::NotFound("FG product not found".to_string()))?;

    if !fg_is_manufactured || !matches!(fg_class, ProductClass::RawMaterial) {
        return Err(DomainError::WorkOrderFgProductNotManufactured {
            product_id: params.fg_product_id,
        });
    }

    // Guard 2: warehouse has ≥1 work_center location (tenant-scoped).
    let wc_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND location_type = 'work_center'",
    )
    .bind(tenant_id)
    .bind(params.warehouse_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;
    if wc_count.0 == 0 {
        return Err(DomainError::WorkOrderWarehouseHasNoWorkCenter {
            warehouse_id: params.warehouse_id,
        });
    }

    // Guard 3: selected work_center belongs to the warehouse AND has
    // type='work_center' (tenant-scoped).
    let wc_loc: Option<(Uuid, LocationType)> = sqlx::query_as(
        "SELECT warehouse_id, location_type FROM locations \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(params.work_center_location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
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
    // Tenant-scoped probe.
    let recipe_exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM recipes \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(params.recipe_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;
    if recipe_exists.is_none() {
        return Err(DomainError::NotFound("Recipe not found".to_string()));
    }

    let recipe_items: Vec<(Uuid, f64, Option<String>, ProductClass)> = sqlx::query_as(
        r#"
        SELECT ri.product_id, ri.quantity::float8, ri.notes, p.product_class
        FROM recipe_items ri
        JOIN products p ON p.id = ri.product_id AND p.tenant_id = ri.tenant_id
        WHERE ri.recipe_id = $1 AND ri.tenant_id = $2
        ORDER BY p.name ASC
        "#,
    )
    .bind(params.recipe_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
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
            (id, tenant_id, code, recipe_id, fg_product_id, fg_quantity,
             status, warehouse_id, work_center_location_id, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10)
        RETURNING id, tenant_id, code, recipe_id, fg_product_id,
                  fg_quantity::float8 AS fg_quantity,
                  status, warehouse_id, work_center_location_id,
                  notes, created_by, created_at, issued_at, completed_at,
                  cancelled_at, updated_at, deleted_at
        "#,
    )
    .bind(wo_id)
    .bind(tenant_id)
    .bind(&code)
    .bind(params.recipe_id)
    .bind(params.fg_product_id)
    .bind(params.fg_quantity)
    .bind(params.warehouse_id)
    .bind(params.work_center_location_id)
    .bind(params.notes.as_deref())
    .bind(params.created_by)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // Snapshot the BOM: one row per recipe item.
    for (product_id, quantity, notes, _class) in &recipe_items {
        sqlx::query(
            "INSERT INTO work_order_materials \
                (tenant_id, work_order_id, product_id, quantity_expected, notes) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(tenant_id)
        .bind(wo_id)
        .bind(product_id)
        .bind(*quantity)
        .bind(notes.as_deref())
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    Ok(WorkOrder::from(row))
}

pub async fn issue(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    user_id: Uuid,
    overrides: Vec<MaterialSourceOverride>,
) -> Result<IssueResult, DomainError> {

    // Lock + validate state. Tenant-scoped — cross-tenant id resolves to
    // NotFound here.
    let wo: Option<WorkOrderRow> = sqlx::query_as::<_, WorkOrderRow>(&format!(
        "SELECT {WO_COLUMNS} FROM work_orders \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let wo = wo.ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;
    if !matches!(wo.status, WorkOrderStatus::Draft) {
        return Err(DomainError::WorkOrderInvalidTransition {
            from: wo.status,
            to: WorkOrderStatus::InProgress,
        });
    }

    // Fetch materials once (tenant-scoped).
    let materials: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
        "SELECT id, product_id, quantity_expected::float8 \
         FROM work_order_materials \
         WHERE work_order_id = $1 AND tenant_id = $2 \
         ORDER BY id ASC",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
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
            None => auto_pick_source_location(&mut *conn, tenant_id, wo.warehouse_id, product_id)
                .await?
                .ok_or_else(|| {
                    DomainError::Validation(format!(
                        "No source location with stock of product {product_id} in warehouse"
                    ))
                })?,
        };

        // Check stock at source (tenant-scoped). INSERT movement directly
        // here instead of calling record_transfer() because the latter
        // emits its own tx, and we need everything in one tx with the
        // final status UPDATE. This mirrors `recipes_repo::dispatch_recipe`.
        let source_qty: (f64,) = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3 FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(from_location_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .unwrap_or((0.0,));

        if source_qty.0 < quantity {
            return Err(DomainError::Validation(format!(
                "Insufficient stock at source location for product {product_id}: available {}, required {}",
                source_qty.0, quantity
            )));
        }

        // Decrement source, upsert destination (work-center). Tenant-scoped UPDATE.
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $4, updated_at = NOW() \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(from_location_id)
        .bind(quantity)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(wo.work_center_location_id)
        .bind(quantity)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // Emit transfer movement with WO linkage.
        let mv_id: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, movement_reason, work_order_id)
            VALUES ($1, $2, $3, $4, $5, 'transfer', $6, 'wo_issue', $7)
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(from_location_id)
        .bind(wo.work_center_location_id)
        .bind(quantity)
        .bind(user_id)
        .bind(id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        movement_ids.push(mv_id.0);
    }

    // Flip status (tenant-scoped UPDATE).
    let updated = sqlx::query_as::<_, WorkOrderRow>(&format!(
        "UPDATE work_orders \
            SET status = 'in_progress', issued_at = NOW(), updated_at = NOW() \
          WHERE id = $1 AND tenant_id = $2 \
          RETURNING {WO_COLUMNS}"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(IssueResult {
        work_order: WorkOrder::from(updated),
        movement_ids,
    })
}

pub async fn complete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    user_id: Uuid,
    fg_expiration_date: Option<NaiveDate>,
) -> Result<CompleteResult, DomainError> {

    // Lock + validate state (tenant-scoped).
    let wo: WorkOrderRow = sqlx::query_as::<_, WorkOrderRow>(&format!(
        "SELECT {WO_COLUMNS} FROM work_orders \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;

    if !matches!(wo.status, WorkOrderStatus::InProgress) {
        return Err(DomainError::WorkOrderInvalidTransition {
            from: wo.status,
            to: WorkOrderStatus::Completed,
        });
    }

    // Load FG product flags (tenant-scoped).
    let fg_has_expiry: (bool,) = sqlx::query_as(
        "SELECT has_expiry FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(wo.fg_product_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let materials: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
        "SELECT id, product_id, quantity_expected::float8 \
         FROM work_order_materials \
         WHERE work_order_id = $1 AND tenant_id = $2 \
         ORDER BY id ASC",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // ── DRY-RUN PHASE ──
    let mut plans: Vec<(Uuid, Uuid, f64, Vec<LotPick>)> = Vec::with_capacity(materials.len());
    let mut missing: Vec<MissingMaterial> = Vec::new();

    for (wom_id, product_id, expected) in &materials {
        let outcome = pick_for_consumption(
            &mut *conn,
            tenant_id,
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
        // Phase C: the outer per-request tx will roll back on this Err
        // surfacing — we just return the domain error here.
        return Err(DomainError::InsufficientWorkOrderStock { missing });
    }

    // ── EXECUTE PHASE ──
    let mut consumed_movement_ids: Vec<Uuid> = Vec::with_capacity(plans.len());

    for (wom_id, product_id, expected, picks) in plans {
        for pick in &picks {
            if let Some(il_id) = pick.lot_id {
                sqlx::query(
                    "UPDATE inventory_lots \
                        SET quantity = quantity - $2, updated_at = NOW() \
                      WHERE id = $1 AND tenant_id = $3",
                )
                .bind(il_id)
                .bind(pick.quantity)
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
                .map_err(map_sqlx_error)?;

                sqlx::query(
                    "DELETE FROM inventory_lots \
                     WHERE id = $1 AND tenant_id = $2 AND quantity <= 0",
                )
                .bind(il_id)
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
                .map_err(map_sqlx_error)?;
            }
        }

        // Single `inventory` decrement per material (tenant-scoped).
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $4, updated_at = NOW() \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(wo.work_center_location_id)
        .bind(expected)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // Emit one back_flush exit movement per material.
        let mv_id: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, movement_reason, work_order_id)
            VALUES ($1, $2, $3, NULL, $4, 'exit', $5, 'back_flush', $6)
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(wo.work_center_location_id)
        .bind(expected)
        .bind(user_id)
        .bind(id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
        consumed_movement_ids.push(mv_id.0);

        // Update quantity_consumed on the snapshot row (tenant-scoped).
        sqlx::query(
            "UPDATE work_order_materials \
                SET quantity_consumed = quantity_expected \
              WHERE id = $1 AND tenant_id = $2",
        )
        .bind(wom_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // Create the FG lot + inventory_lots + inventory + production_output movement.
    let fg_location_id = find_finished_good_in_tx(&mut *conn, tenant_id, wo.warehouse_id).await?;
    let lot_number = format!("WO-{}-{}", wo.code, Utc::now().format("%Y%m%d"));
    let effective_exp = if fg_has_expiry.0 {
        fg_expiration_date
    } else {
        None
    };
    let batch_date = Utc::now().date_naive();

    let fg_lot_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO product_lots
            (tenant_id, product_id, lot_number, batch_date, expiration_date,
             received_quantity, quality_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(wo.fg_product_id)
    .bind(&lot_number)
    .bind(batch_date)
    .bind(effective_exp)
    .bind(wo.fg_quantity)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    sqlx::query(
        "INSERT INTO inventory_lots (tenant_id, product_lot_id, location_id, quantity) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (product_lot_id, location_id) \
         DO UPDATE SET quantity = inventory_lots.quantity + $4, updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(fg_lot_id.0)
    .bind(fg_location_id)
    .bind(wo.fg_quantity)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    sqlx::query(
        "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (product_id, location_id) \
         DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(wo.fg_product_id)
    .bind(fg_location_id)
    .bind(wo.fg_quantity)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let fg_mv_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO movements
            (tenant_id, product_id, from_location_id, to_location_id, quantity,
             movement_type, user_id, reference, movement_reason, work_order_id)
        VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6, 'production_output', $7)
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(wo.fg_product_id)
    .bind(fg_location_id)
    .bind(wo.fg_quantity)
    .bind(user_id)
    .bind(&lot_number)
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let updated = sqlx::query_as::<_, WorkOrderRow>(&format!(
        "UPDATE work_orders \
            SET status = 'completed', completed_at = NOW(), updated_at = NOW() \
          WHERE id = $1 AND tenant_id = $2 \
          RETURNING {WO_COLUMNS}"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(CompleteResult {
        work_order: WorkOrder::from(updated),
        consumed_movement_ids,
        fg_lot_id: fg_lot_id.0,
        fg_movement_id: fg_mv_id.0,
    })
}

pub async fn cancel(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    user_id: Uuid,
) -> Result<CancelResult, DomainError> {

    let wo: WorkOrderRow = sqlx::query_as::<_, WorkOrderRow>(&format!(
        "SELECT {WO_COLUMNS} FROM work_orders \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Work order not found".to_string()))?;

    let mut reversal_movement_ids: Vec<Uuid> = Vec::new();

    match wo.status {
        WorkOrderStatus::Draft => {
            // Nothing to reverse — just stamp cancelled_at.
        }
        WorkOrderStatus::InProgress => {
            // Find every wo_issue movement (tenant-scoped). Emit a mirrored
            // reverse transfer for each.
            let issues: Vec<(Uuid, Uuid, Option<Uuid>, Option<Uuid>, f64)> = sqlx::query_as(
                r#"
                SELECT id, product_id, from_location_id, to_location_id, quantity::float8
                FROM movements
                WHERE work_order_id = $1
                  AND tenant_id = $2
                  AND movement_reason = 'wo_issue'
                ORDER BY created_at ASC
                "#,
            )
            .bind(id)
            .bind(tenant_id)
            .fetch_all(&mut *conn)
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

                // Decrement work-center, upsert original source (tenant-scoped).
                sqlx::query(
                    "UPDATE inventory SET quantity = quantity - $4, updated_at = NOW() \
                     WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3",
                )
                .bind(tenant_id)
                .bind(product_id)
                .bind(reverse_from)
                .bind(quantity)
                .execute(&mut *conn)
                .await
                .map_err(map_sqlx_error)?;

                sqlx::query(
                    "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
                     VALUES ($1, $2, $3, $4) \
                     ON CONFLICT (product_id, location_id) \
                     DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()",
                )
                .bind(tenant_id)
                .bind(product_id)
                .bind(reverse_to)
                .bind(quantity)
                .execute(&mut *conn)
                .await
                .map_err(map_sqlx_error)?;

                let mv_id: (Uuid,) = sqlx::query_as(
                    r#"
                    INSERT INTO movements
                        (tenant_id, product_id, from_location_id, to_location_id, quantity,
                         movement_type, user_id, movement_reason, work_order_id)
                    VALUES ($1, $2, $3, $4, $5, 'transfer', $6, 'wo_cancel_reversal', $7)
                    RETURNING id
                    "#,
                )
                .bind(tenant_id)
                .bind(product_id)
                .bind(reverse_from)
                .bind(reverse_to)
                .bind(quantity)
                .bind(user_id)
                .bind(id)
                .fetch_one(&mut *conn)
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
          WHERE id = $1 AND tenant_id = $2 \
          RETURNING {WO_COLUMNS}"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(CancelResult {
        work_order: WorkOrder::from(updated),
        reversal_movement_ids,
    })
}
