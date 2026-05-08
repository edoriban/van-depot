//! Lots repository — `product_lots` + `inventory_lots` operations.
//!
//! Phase B batch 4 (multi-tenant-foundation, design §5.4) tightened every
//! query to be tenant-scoped and updated every INSERT into
//! `product_lots`/`inventory_lots`/`inventory`/`movements` to carry
//! `tenant_id`. The composite FKs installed by 20260508000004 enforce that
//! the supplied `tenant_id` matches the parent rows referenced from each
//! INSERT — a cross-tenant id surfaces as a 23503 FK violation, mapped to a
//! 409 by `map_sqlx_error`.
//!
//! Function shapes:
//!   * Read functions take `(&mut PgConnection, tenant_id, ...)`.
//!   * Write functions take `(&PgPool, tenant_id, ...)` because they begin
//!     their own transaction.
//!   * Internal helpers passed an open tx (`fetch_product_class_guard`,
//!     `find_reception_by_warehouse`, `perform_transfer_in_tx`) take
//!     `tenant_id` so they can scope every query they run.
//!
//! Why we kept this in one file (instead of splitting product_lot vs
//! inventory_lot): the receive/distribute/transfer flows touch BOTH tables
//! plus inventory + movements as a single atomic unit. Splitting would
//! force a third "shared helpers" module without simplifying anything.
//! The two row structs (`ProductLotRow`, `InventoryLotRow`) live side by
//! side as the existing pattern.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{LocationType, MovementType, ProductClass, QualityStatus};
use vandepot_domain::models::product_lot::ProductLot;
use vandepot_domain::models::receive_outcome::ReceiveOutcome;

use super::purchase_order_repo::recalculate_po_status_in_tx;
use super::shared::map_sqlx_error;

impl From<ProductLotRow> for ProductLot {
    fn from(row: ProductLotRow) -> Self {
        ProductLot {
            id: row.id,
            tenant_id: row.tenant_id,
            product_id: row.product_id,
            lot_number: row.lot_number,
            batch_date: row.batch_date,
            expiration_date: row.expiration_date,
            supplier_id: row.supplier_id,
            received_quantity: row.received_quantity,
            quality_status: row.quality_status,
            notes: row.notes,
            purchase_order_line_id: row.purchase_order_line_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Fetch `(product_class, has_expiry)` for `product_id` inside an open
/// transaction. Returns `NotFound` if the product does not exist, is
/// soft-deleted, or belongs to a different tenant. Used by `create_lot`
/// and `receive_lot` to branch on class before touching `product_lots`.
pub(crate) async fn fetch_product_class_guard(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
) -> Result<(ProductClass, bool), DomainError> {
    let row: Option<(ProductClass, bool)> = sqlx::query_as(
        "SELECT product_class, has_expiry FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(product_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    row.ok_or_else(|| DomainError::NotFound("Product not found".to_string()))
}

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct ProductLotRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub product_id: Uuid,
    pub lot_number: String,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub supplier_id: Option<Uuid>,
    pub received_quantity: f64,
    pub quality_status: QualityStatus,
    pub notes: Option<String>,
    pub purchase_order_line_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct InventoryLotRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub product_lot_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub quantity: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct LotWithInventoryRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub product_id: Uuid,
    pub lot_number: String,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub supplier_id: Option<Uuid>,
    pub received_quantity: f64,
    pub quality_status: QualityStatus,
    pub notes: Option<String>,
    pub total_quantity: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct LotMovementRow {
    pub id: Uuid,
    pub product_id: Uuid,
    pub movement_type: MovementType,
    pub from_location_id: Option<Uuid>,
    pub from_location_name: Option<String>,
    pub to_location_id: Option<Uuid>,
    pub to_location_name: Option<String>,
    pub quantity: f64,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

// ── Queries ─────────────────────────────────────────────────────────

pub async fn create_lot(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
    lot_number: &str,
    batch_date: Option<NaiveDate>,
    expiration_date: Option<NaiveDate>,
    supplier_id: Option<Uuid>,
    notes: Option<&str>,
) -> Result<ProductLotRow, DomainError> {
    // Guard: reject lot creation for product classes that do not support
    // lots (tool_spare always; consumable requires has_expiry=true). We wrap
    // in a transaction so the class read and the insert see the same
    // snapshot even under concurrent `update`/`reclassify` writes.
    let (class, has_expiry) = fetch_product_class_guard(&mut *conn, tenant_id, product_id).await?;
    if matches!(class, ProductClass::ToolSpare) {
        return Err(DomainError::ProductClassDoesNotSupportLots);
    }
    if matches!(class, ProductClass::Consumable) && !has_expiry {
        return Err(DomainError::ProductClassDoesNotSupportLots);
    }

    let row = sqlx::query_as::<_, ProductLotRow>(
        r#"
        INSERT INTO product_lots
            (tenant_id, product_id, lot_number, batch_date, expiration_date, supplier_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, tenant_id, product_id, lot_number, batch_date, expiration_date,
                  supplier_id, received_quantity::float8, quality_status,
                  notes, purchase_order_line_id, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(lot_number)
    .bind(batch_date)
    .bind(expiration_date)
    .bind(supplier_id)
    .bind(notes)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn list_lots_by_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
) -> Result<Vec<LotWithInventoryRow>, DomainError> {
    let rows = sqlx::query_as::<_, LotWithInventoryRow>(
        r#"
        SELECT pl.id, pl.tenant_id, pl.product_id, pl.lot_number, pl.batch_date,
               pl.expiration_date, pl.supplier_id,
               pl.received_quantity::float8, pl.quality_status, pl.notes,
               COALESCE(SUM(il.quantity), 0)::float8 AS total_quantity,
               pl.created_at, pl.updated_at
        FROM product_lots pl
        LEFT JOIN inventory_lots il ON pl.id = il.product_lot_id
        WHERE pl.tenant_id = $1 AND pl.product_id = $2
        GROUP BY pl.id
        ORDER BY pl.created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

pub async fn get_lot(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
) -> Result<ProductLotRow, DomainError> {
    let row = sqlx::query_as::<_, ProductLotRow>(
        r#"
        SELECT id, tenant_id, product_id, lot_number, batch_date, expiration_date,
               supplier_id, received_quantity::float8, quality_status,
               notes, purchase_order_line_id, created_at, updated_at
        FROM product_lots
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn get_lot_inventory(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
) -> Result<Vec<InventoryLotRow>, DomainError> {
    let rows = sqlx::query_as::<_, InventoryLotRow>(
        r#"
        SELECT il.id, il.tenant_id, il.product_lot_id, il.location_id,
               l.name AS location_name,
               il.quantity::float8, il.created_at, il.updated_at
        FROM inventory_lots il
        JOIN locations l ON il.location_id = l.id
        WHERE il.tenant_id = $1 AND il.product_lot_id = $2
        ORDER BY l.name ASC
        "#,
    )
    .bind(tenant_id)
    .bind(lot_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

/// Receive inbound material with transactional integrity.
///
/// Branches on the product's class after resolving Recepción:
///
/// - For classes that support lots (`raw_material`, or `consumable` with
///   `has_expiry = true`) the classic flow runs: upsert `product_lots`,
///   update received_quantity, upsert `inventory_lots`, upsert `inventory`,
///   stamp entry movement(s), link to PO line if provided, and return
///   `ReceiveOutcome::Lot`.
/// - For classes that do NOT support lots (`tool_spare`, or `consumable`
///   with `has_expiry = false`) the no-lot flow runs: upsert `inventory`
///   with `lot_id = NULL` at Recepción, stamp an entry movement with no
///   lot reference, and return `ReceiveOutcome::DirectInventory`. The PO
///   line — if provided — still advances, but no `product_lots` row is
///   created.
///
/// Tenant-scoped: every INSERT carries `tenant_id`, the warehouse/Recepción
/// resolution filters on tenant_id, and the product class lookup
/// (`fetch_product_class_guard`) does too.
#[allow(clippy::too_many_arguments)]
pub async fn receive_lot(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
    lot_number: &str,
    warehouse_id: Uuid,
    good_qty: f64,
    defect_qty: f64,
    supplier_id: Option<Uuid>,
    batch_date: Option<NaiveDate>,
    expiration_date: Option<NaiveDate>,
    user_id: Uuid,
    notes: Option<&str>,
    purchase_order_line_id: Option<Uuid>,
    purchase_order_id: Option<Uuid>,
) -> Result<ReceiveOutcome, DomainError> {

    // 0. Resolve the warehouse's Recepción — all inbound material lands here.
    //    Missing Recepción means a data-integrity violation (all active
    //    warehouses are guaranteed to have one post-migration); surface 409.
    let location_id = find_reception_by_warehouse(&mut *conn, tenant_id, warehouse_id).await?;

    // 0.5 Classify the product. Tool spares and expiry-less consumables
    //     skip the lot path entirely and land as direct inventory.
    let (class, has_expiry) = fetch_product_class_guard(&mut *conn, tenant_id, product_id).await?;
    let is_no_lot = matches!(class, ProductClass::ToolSpare)
        || (matches!(class, ProductClass::Consumable) && !has_expiry);

    if is_no_lot {
        let outcome = receive_direct_inventory_in_tx(
            &mut *conn,
            tenant_id,
            product_id,
            location_id,
            good_qty,
            defect_qty,
            supplier_id,
            user_id,
            notes,
            lot_number,
            purchase_order_line_id,
            purchase_order_id,
        )
        .await?;
                return Ok(outcome);
    }

    // 1. INSERT or get existing lot
    let lot_row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO product_lots
            (tenant_id, product_id, lot_number, batch_date, expiration_date, supplier_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (product_id, lot_number) DO UPDATE SET updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(lot_number)
    .bind(batch_date)
    .bind(expiration_date)
    .bind(supplier_id)
    .bind(notes)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let lot_id = lot_row.0;
    let total_received = good_qty + defect_qty;

    // 2. UPDATE received_quantity
    sqlx::query(
        "UPDATE product_lots SET received_quantity = received_quantity + $2 WHERE id = $1",
    )
    .bind(lot_id)
    .bind(total_received)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // 3. UPSERT inventory_lots for good quantity
    if good_qty > 0.0 {
        sqlx::query(
            r#"
            INSERT INTO inventory_lots (tenant_id, product_lot_id, location_id, quantity)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (product_lot_id, location_id)
            DO UPDATE SET quantity = inventory_lots.quantity + $4, updated_at = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(lot_id)
        .bind(location_id)
        .bind(good_qty)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 4. If defect_qty > 0, track separately (lot quality_status stays as-is;
    //    defective items are recorded via movement but not added to usable stock)
    // Note: defective quantity is tracked via the movement record with reason 'quality_reject'

    // 5. UPSERT main inventory table (good_qty only)
    if good_qty > 0.0 {
        sqlx::query(
            r#"
            INSERT INTO inventory (tenant_id, product_id, location_id, quantity)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (product_id, location_id)
            DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // 6. INSERT movement for good qty (with purchase_order_id if provided)
        sqlx::query(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6, $7, $8, 'purchase_receive', $9)
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(lot_number)
        .bind(notes)
        .bind(purchase_order_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 7. If defect_qty > 0, INSERT movement for defect qty
    if defect_qty > 0.0 {
        sqlx::query(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6, $7, $8, 'quality_reject', $9)
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(defect_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(lot_number)
        .bind(notes)
        .bind(purchase_order_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 8. If linked to a PO line: verify status, update quantity_received, recalculate PO status
    if let (Some(line_id), Some(po_id)) = (purchase_order_line_id, purchase_order_id) {
        // Verify the PO is in a receivable status. Phase B B6: tenant-scoped
        // — cross-tenant po_id resolves to NotFound here BEFORE the composite
        // FK on `movements.purchase_order_id` would fire on the INSERTs above.
        let po_status: Option<(String,)> = sqlx::query_as(
            "SELECT status::text FROM purchase_orders WHERE id = $1 AND tenant_id = $2",
        )
        .bind(po_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        match po_status {
            None => {
                return Err(DomainError::NotFound(
                    "Purchase order not found".to_string(),
                ))
            }
            Some((status,)) if status != "sent" && status != "partially_received" => {
                return Err(DomainError::Validation(format!(
                    "Cannot receive against a purchase order in status '{}'",
                    status
                )))
            }
            _ => {}
        }

        // Update quantity_received on the line (tenant-scoped).
        sqlx::query(
            r#"
            UPDATE purchase_order_lines
            SET quantity_received = quantity_received + $2
            WHERE id = $1 AND tenant_id = $3
            "#,
        )
        .bind(line_id)
        .bind(good_qty)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // Recalculate PO status (tenant-scoped per B6 signature).
        recalculate_po_status_in_tx(&mut *conn, tenant_id, po_id)
            .await
            .map_err(map_sqlx_error)?;

        // 9. Link the lot to the PO line (tenant-scoped on both sides; the
        //    composite FK `product_lots_po_line_tenant_fk` would also reject
        //    a cross-tenant line at the DB layer).
        sqlx::query(
            "UPDATE product_lots SET purchase_order_line_id = $2 \
             WHERE id = $1 AND tenant_id = $3",
        )
        .bind(lot_id)
        .bind(line_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 10. Return the lot
    let lot = sqlx::query_as::<_, ProductLotRow>(
        r#"
        SELECT id, tenant_id, product_id, lot_number, batch_date, expiration_date,
               supplier_id, received_quantity::float8, quality_status,
               notes, purchase_order_line_id, created_at, updated_at
        FROM product_lots
        WHERE id = $1
        "#,
    )
    .bind(lot_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(ReceiveOutcome::Lot(ProductLot::from(lot)))
}

/// No-lot receive path used for `tool_spare` and `consumable + !has_expiry`.
///
/// Skips `product_lots` entirely: material still lands at Recepción via the
/// main `inventory` table (upsert on `(product_id, location_id)`), and a
/// single entry movement is stamped with `lot_id = NULL` / no lot reference.
#[allow(clippy::too_many_arguments)]
async fn receive_direct_inventory_in_tx(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    product_id: Uuid,
    location_id: Uuid,
    good_qty: f64,
    defect_qty: f64,
    supplier_id: Option<Uuid>,
    user_id: Uuid,
    notes: Option<&str>,
    reference: &str,
    purchase_order_line_id: Option<Uuid>,
    purchase_order_id: Option<Uuid>,
) -> Result<ReceiveOutcome, DomainError> {
    // Upsert the main inventory row for good_qty and capture its id for the
    // outcome payload. For no-lot receives we treat good_qty == 0 as a
    // legitimate receive (defect-only) — the inventory stays unchanged but
    // we still need an id to echo back, so we upsert a 0-delta row.
    let inventory_id: Uuid = if good_qty > 0.0 {
        let row: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO inventory (tenant_id, product_id, location_id, quantity)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (product_id, location_id)
            DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
        row.0
    } else {
        // No positive delta — upsert a 0 row (idempotent) and read back id.
        sqlx::query(
            r#"
            INSERT INTO inventory (tenant_id, product_id, location_id, quantity)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (product_id, location_id) DO NOTHING
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        let row: (Uuid,) = sqlx::query_as(
            "SELECT id FROM inventory \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
        row.0
    };

    // Entry movement for good qty — lot_id is intentionally absent. The
    // `reference` column still carries the client-supplied lot_number (if
    // any) so traceability downstream is not lost.
    let mut primary_movement_id: Option<Uuid> = None;
    if good_qty > 0.0 {
        let row: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6, $7, $8, 'purchase_receive', $9)
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(reference)
        .bind(notes)
        .bind(purchase_order_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
        primary_movement_id = Some(row.0);
    }

    if defect_qty > 0.0 {
        let row: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO movements
                (tenant_id, product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6, $7, $8, 'quality_reject', $9)
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(defect_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(reference)
        .bind(notes)
        .bind(purchase_order_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
        if primary_movement_id.is_none() {
            primary_movement_id = Some(row.0);
        }
    }

    // Advance the PO line if one was supplied — identical to the lot path
    // except we skip the `UPDATE product_lots … purchase_order_line_id` step.
    // Phase B B6: tenant-scoped existence + UPDATE.
    if let (Some(line_id), Some(po_id)) = (purchase_order_line_id, purchase_order_id) {
        let po_status: Option<(String,)> = sqlx::query_as(
            "SELECT status::text FROM purchase_orders WHERE id = $1 AND tenant_id = $2",
        )
        .bind(po_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        match po_status {
            None => {
                return Err(DomainError::NotFound(
                    "Purchase order not found".to_string(),
                ))
            }
            Some((status,)) if status != "sent" && status != "partially_received" => {
                return Err(DomainError::Validation(format!(
                    "Cannot receive against a purchase order in status '{}'",
                    status
                )))
            }
            _ => {}
        }

        sqlx::query(
            r#"
            UPDATE purchase_order_lines
            SET quantity_received = quantity_received + $2
            WHERE id = $1 AND tenant_id = $3
            "#,
        )
        .bind(line_id)
        .bind(good_qty)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        recalculate_po_status_in_tx(&mut *conn, tenant_id, po_id)
            .await
            .map_err(map_sqlx_error)?;
    }

    // If neither good nor defect movement was stamped (both zero), the
    // validation layer should have rejected the call — surface a sensible
    // error rather than returning a fabricated movement id.
    let movement_id = primary_movement_id.ok_or_else(|| {
        DomainError::Validation("At least one quantity must be greater than 0".to_string())
    })?;

    Ok(ReceiveOutcome::DirectInventory {
        inventory_id,
        movement_id,
        product_id,
        location_id,
        quantity: good_qty,
    })
}

// ── Quality Status ─────────────────────────────────────────────────

pub async fn update_quality_status(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
    new_status: QualityStatus,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<ProductLotRow, DomainError> {

    // 1. Verify lot exists in this tenant and get current status. A
    //    cross-tenant id resolves to NotFound here.
    let current = sqlx::query_as::<_, (QualityStatus, Uuid, String)>(
        "SELECT quality_status, product_id, lot_number FROM product_lots \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Lot not found".to_string()))?;

    let (old_status, product_id, lot_number) = current;

    // 2. Update quality_status
    sqlx::query(
        "UPDATE product_lots SET quality_status = $2, updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $3",
    )
    .bind(lot_id)
    .bind(&new_status)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // 3. Create audit movement
    let movement_notes = match notes {
        Some(n) => format!(
            "Quality status changed from {:?} to {:?}. {}",
            old_status, new_status, n
        ),
        None => format!(
            "Quality status changed from {:?} to {:?}",
            old_status, new_status
        ),
    };

    sqlx::query(
        r#"
        INSERT INTO movements
            (tenant_id, product_id, from_location_id, to_location_id, quantity,
             movement_type, user_id, reference, notes)
        VALUES ($1, $2, NULL, NULL, 0, 'adjustment', $3, $4, $5)
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(user_id)
    .bind(&lot_number)
    .bind(&movement_notes)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // 4. Return updated lot
    let lot = sqlx::query_as::<_, ProductLotRow>(
        r#"
        SELECT id, tenant_id, product_id, lot_number, batch_date, expiration_date,
               supplier_id, received_quantity::float8, quality_status,
               notes, purchase_order_line_id, created_at, updated_at
        FROM product_lots
        WHERE id = $1
        "#,
    )
    .bind(lot_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(lot)
}

// ── Transfer Lot ───────────────────────────────────────────────────

pub async fn transfer_lot(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
    from_location_id: Uuid,
    to_location_id: Uuid,
    quantity: f64,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<(), DomainError> {
    // Validate from != to
    if from_location_id == to_location_id {
        return Err(DomainError::Validation(
            "Source and destination locations must be different".to_string(),
        ));
    }

    // Validate quantity > 0
    if quantity <= 0.0 {
        return Err(DomainError::Validation(
            "Transfer quantity must be greater than 0".to_string(),
        ));
    }


    // Reject Reception endpoints — the receive→distribute flow must use the
    // dedicated /lots/{id}/distribute endpoint so movement reasons stay
    // honest for downstream valuation/KPI features. Tenant-scoped lookup so
    // cross-tenant location_ids resolve to NotFound, not "wrong type".
    let types = sqlx::query_as::<_, (LocationType, LocationType)>(
        "SELECT f.location_type, t.location_type \
         FROM locations f, locations t \
         WHERE f.id = $1 AND t.id = $2 \
           AND f.tenant_id = $3 AND t.tenant_id = $3",
    )
    .bind(from_location_id)
    .bind(to_location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Source or destination location not found".to_string()))?;
    if matches!(types.0, LocationType::Reception) || matches!(types.1, LocationType::Reception) {
        return Err(DomainError::Validation(
            "Use POST /lots/{id}/distribute to move from or to a Reception location".to_string(),
        ));
    }

    perform_transfer_in_tx(
        &mut *conn,
        tenant_id,
        lot_id,
        from_location_id,
        to_location_id,
        quantity,
        user_id,
        notes,
        "transfer",
    )
    .await?;

    Ok(())
}

// ── Distribute Lot ─────────────────────────────────────────────────
//
// Moves inventory from the lot's Recepción to a non-Reception destination in
// the same warehouse. Shares `perform_transfer_in_tx` with `transfer_lot` so
// the core SQL is not duplicated; the only thing that differs is the
// movement_reason tag stamped on the resulting movement row.
pub async fn distribute_lot(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
    to_location_id: Uuid,
    quantity: f64,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<(), DomainError> {
    if quantity <= 0.0 {
        return Err(DomainError::Validation(
            "Distribute quantity must be greater than 0".to_string(),
        ));
    }


    // Verify the lot exists in this tenant before trying to resolve its
    // Reception row.
    let lot_exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM product_lots WHERE id = $1 AND tenant_id = $2",
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;
    if lot_exists.is_none() {
        return Err(DomainError::NotFound("Lot not found".to_string()));
    }

    // Resolve the warehouse + its Reception id via the lot's current
    // inventory_lots row in a Reception-type location.
    let src = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT l.warehouse_id, l.id \
         FROM inventory_lots il \
         JOIN locations l ON l.id = il.location_id \
         WHERE il.product_lot_id = $1 \
           AND il.tenant_id = $2 \
           AND l.location_type = 'reception' \
         LIMIT 1",
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| {
        DomainError::Validation("Lot has no inventory in a Reception location".to_string())
    })?;
    let (warehouse_id, reception_id) = (src.0, src.1);

    // Validate destination: exists in this tenant, same warehouse, NOT a
    // Reception.
    let target = sqlx::query_as::<_, (Uuid, LocationType)>(
        "SELECT warehouse_id, location_type FROM locations \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(to_location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Destination location not found".to_string()))?;
    if target.0 != warehouse_id {
        return Err(DomainError::Validation(
            "Destination must be in the same warehouse".to_string(),
        ));
    }
    if matches!(target.1, LocationType::Reception) {
        return Err(DomainError::Validation(
            "Destination cannot be a Reception location".to_string(),
        ));
    }

    perform_transfer_in_tx(
        &mut *conn,
        tenant_id,
        lot_id,
        reception_id,
        to_location_id,
        quantity,
        user_id,
        notes,
        "distribute_from_reception",
    )
    .await?;

    Ok(())
}

// ── Shared in-tx helpers ───────────────────────────────────────────

/// Resolves the `locations.id` of the Recepción row for `warehouse_id` inside
/// an open transaction. Tenant-scoped — a cross-tenant warehouse_id surfaces
/// as the same Conflict (not exposing the difference between "wrong tenant"
/// and "missing Reception" doesn't leak useful information; both indicate
/// the caller cannot receive against this warehouse).
pub(crate) async fn find_reception_by_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Uuid, DomainError> {
    sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM locations \
         WHERE warehouse_id = $1 \
           AND tenant_id = $2 \
           AND location_type = 'reception' \
         LIMIT 1",
    )
    .bind(warehouse_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .map(|r| r.0)
    .ok_or_else(|| {
        DomainError::Conflict(
            "Warehouse has no Recepción location — data integrity error".to_string(),
        )
    })
}

/// Moves `quantity` of `lot_id` between two locations inside an open
/// transaction. Decrements source `inventory_lots`/`inventory`, upserts at
/// destination, and stamps a `transfer`-type movement with the supplied
/// `movement_reason` tag.
///
/// Tenant-scoped: looks up the lot's product_id within `tenant_id`, scopes
/// inventory_lots / inventory reads + writes by `tenant_id`, and stamps
/// the resulting movement with `tenant_id`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn perform_transfer_in_tx(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
    from_location_id: Uuid,
    to_location_id: Uuid,
    quantity: f64,
    user_id: Uuid,
    notes: Option<&str>,
    movement_reason: &str,
) -> Result<(), DomainError> {
    // Get lot info — tenant-scoped.
    let lot = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT product_id, lot_number FROM product_lots \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let (product_id, lot_number) = lot;

    // Verify inventory_lots has enough qty at from_location
    let current_qty: f64 = sqlx::query_as::<_, (f64,)>(
        "SELECT quantity::float8 FROM inventory_lots \
         WHERE product_lot_id = $1 AND location_id = $2 AND tenant_id = $3 FOR UPDATE",
    )
    .bind(lot_id)
    .bind(from_location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .map(|r| r.0)
    .unwrap_or(0.0);

    if current_qty < quantity {
        return Err(DomainError::Validation(format!(
            "Insufficient lot stock at source location. Available: {}, requested: {}",
            current_qty, quantity
        )));
    }

    // Decrement inventory_lots at from_location (delete if reaches 0)
    let remaining = current_qty - quantity;
    if remaining <= 0.0 {
        sqlx::query(
            "DELETE FROM inventory_lots \
             WHERE product_lot_id = $1 AND location_id = $2 AND tenant_id = $3",
        )
        .bind(lot_id)
        .bind(from_location_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    } else {
        sqlx::query(
            "UPDATE inventory_lots SET quantity = $4, updated_at = NOW() \
             WHERE product_lot_id = $1 AND location_id = $2 AND tenant_id = $3",
        )
        .bind(lot_id)
        .bind(from_location_id)
        .bind(tenant_id)
        .bind(remaining)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    // Upsert inventory_lots at to_location
    sqlx::query(
        r#"
        INSERT INTO inventory_lots (tenant_id, product_lot_id, location_id, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_lot_id, location_id)
        DO UPDATE SET quantity = inventory_lots.quantity + $4, updated_at = NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(lot_id)
    .bind(to_location_id)
    .bind(quantity)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // Decrement generic inventory at from_location
    sqlx::query(
        "UPDATE inventory SET quantity = quantity - $4, updated_at = NOW() \
         WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3",
    )
    .bind(product_id)
    .bind(from_location_id)
    .bind(tenant_id)
    .bind(quantity)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // Upsert generic inventory at to_location
    sqlx::query(
        r#"
        INSERT INTO inventory (tenant_id, product_id, location_id, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id, location_id)
        DO UPDATE SET quantity = inventory.quantity + $4, updated_at = NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(to_location_id)
    .bind(quantity)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    // Create transfer movement (with the caller-supplied movement_reason so
    // valuation/KPI pipelines can tell a receive-distribute hop from a plain
    // shelf-to-shelf transfer).
    sqlx::query(
        r#"
        INSERT INTO movements
            (tenant_id, product_id, from_location_id, to_location_id, quantity,
             movement_type, user_id, reference, notes, movement_reason)
        VALUES ($1, $2, $3, $4, $5, 'transfer', $6, $7, $8, $9)
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(from_location_id)
    .bind(to_location_id)
    .bind(quantity)
    .bind(user_id)
    .bind(&lot_number)
    .bind(notes)
    .bind(movement_reason)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

// ── Lot Movements (traceability) ───────────────────────────────────

pub async fn get_lot_movements(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    lot_id: Uuid,
) -> Result<Vec<LotMovementRow>, DomainError> {
    // Get lot info — tenant-scoped (cross-tenant id surfaces as NotFound).
    let lot = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT product_id, lot_number FROM product_lots \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(lot_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let (product_id, lot_number) = lot;

    let rows = sqlx::query_as::<_, LotMovementRow>(
        r#"
        SELECT m.id, m.product_id, m.movement_type,
               m.from_location_id, fl.name AS from_location_name,
               m.to_location_id, tl.name AS to_location_name,
               m.quantity::float8, m.reference, m.notes, m.user_id, m.created_at
        FROM movements m
        LEFT JOIN locations fl ON m.from_location_id = fl.id
        LEFT JOIN locations tl ON m.to_location_id = tl.id
        WHERE m.tenant_id = $1
          AND m.product_id = $2
          AND (m.reference = $3 OR m.notes LIKE '%' || $3 || '%')
        ORDER BY m.created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(&lot_number)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}
