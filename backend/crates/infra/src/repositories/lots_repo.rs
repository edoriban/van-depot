use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::QualityStatus;

use super::purchase_order_repo::recalculate_po_status_in_tx;
use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct ProductLotRow {
    pub id: Uuid,
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

// ── Queries ─────────────────────────────────────────────────────────

pub async fn create_lot(
    pool: &PgPool,
    product_id: Uuid,
    lot_number: &str,
    batch_date: Option<NaiveDate>,
    expiration_date: Option<NaiveDate>,
    supplier_id: Option<Uuid>,
    notes: Option<&str>,
) -> Result<ProductLotRow, DomainError> {
    let row = sqlx::query_as::<_, ProductLotRow>(
        r#"
        INSERT INTO product_lots
            (product_id, lot_number, batch_date, expiration_date, supplier_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, product_id, lot_number, batch_date, expiration_date,
                  supplier_id, received_quantity::float8, quality_status,
                  notes, purchase_order_line_id, created_at, updated_at
        "#,
    )
    .bind(product_id)
    .bind(lot_number)
    .bind(batch_date)
    .bind(expiration_date)
    .bind(supplier_id)
    .bind(notes)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn list_lots_by_product(
    pool: &PgPool,
    product_id: Uuid,
) -> Result<Vec<LotWithInventoryRow>, DomainError> {
    let rows = sqlx::query_as::<_, LotWithInventoryRow>(
        r#"
        SELECT pl.id, pl.product_id, pl.lot_number, pl.batch_date,
               pl.expiration_date, pl.supplier_id,
               pl.received_quantity::float8, pl.quality_status, pl.notes,
               COALESCE(SUM(il.quantity), 0)::float8 AS total_quantity,
               pl.created_at, pl.updated_at
        FROM product_lots pl
        LEFT JOIN inventory_lots il ON pl.id = il.product_lot_id
        WHERE pl.product_id = $1
        GROUP BY pl.id
        ORDER BY pl.created_at DESC
        "#,
    )
    .bind(product_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

pub async fn get_lot(
    pool: &PgPool,
    lot_id: Uuid,
) -> Result<ProductLotRow, DomainError> {
    let row = sqlx::query_as::<_, ProductLotRow>(
        r#"
        SELECT id, product_id, lot_number, batch_date, expiration_date,
               supplier_id, received_quantity::float8, quality_status,
               notes, purchase_order_line_id, created_at, updated_at
        FROM product_lots
        WHERE id = $1
        "#,
    )
    .bind(lot_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row)
}

pub async fn get_lot_inventory(
    pool: &PgPool,
    lot_id: Uuid,
) -> Result<Vec<InventoryLotRow>, DomainError> {
    let rows = sqlx::query_as::<_, InventoryLotRow>(
        r#"
        SELECT il.id, il.product_lot_id, il.location_id,
               l.name AS location_name,
               il.quantity::float8, il.created_at, il.updated_at
        FROM inventory_lots il
        JOIN locations l ON il.location_id = l.id
        WHERE il.product_lot_id = $1
        ORDER BY l.name ASC
        "#,
    )
    .bind(lot_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows)
}

/// Receive a lot with transactional integrity.
///
/// 1. INSERT or get existing product_lot by (product_id, lot_number)
/// 2. UPDATE received_quantity
/// 3. UPSERT inventory_lots for good quantity
/// 4. If defect_qty > 0, UPSERT inventory_lots with separate tracking
/// 5. UPSERT main inventory table (good_qty only goes to usable stock)
/// 6. INSERT movement for good qty (reason = 'purchase_receive'), with purchase_order_id if provided
/// 7. If defect_qty > 0, INSERT movement for defect qty (reason = 'quality_reject')
/// 8. If purchase_order_line_id provided: verify PO status, increment quantity_received, recalculate PO status
/// 9. Link lot to PO line if provided
/// 10. Return the lot
#[allow(clippy::too_many_arguments)]
pub async fn receive_lot(
    pool: &PgPool,
    product_id: Uuid,
    lot_number: &str,
    location_id: Uuid,
    good_qty: f64,
    defect_qty: f64,
    supplier_id: Option<Uuid>,
    batch_date: Option<NaiveDate>,
    expiration_date: Option<NaiveDate>,
    user_id: Uuid,
    notes: Option<&str>,
    purchase_order_line_id: Option<Uuid>,
    purchase_order_id: Option<Uuid>,
) -> Result<ProductLotRow, DomainError> {
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // 1. INSERT or get existing lot
    let lot_row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO product_lots
            (product_id, lot_number, batch_date, expiration_date, supplier_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (product_id, lot_number) DO UPDATE SET updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(product_id)
    .bind(lot_number)
    .bind(batch_date)
    .bind(expiration_date)
    .bind(supplier_id)
    .bind(notes)
    .fetch_one(&mut *tx)
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
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    // 3. UPSERT inventory_lots for good quantity
    if good_qty > 0.0 {
        sqlx::query(
            r#"
            INSERT INTO inventory_lots (product_lot_id, location_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_lot_id, location_id)
            DO UPDATE SET quantity = inventory_lots.quantity + $3, updated_at = NOW()
            "#,
        )
        .bind(lot_id)
        .bind(location_id)
        .bind(good_qty)
        .execute(&mut *tx)
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
            INSERT INTO inventory (product_id, location_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_id, location_id)
            DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()
            "#,
        )
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // 6. INSERT movement for good qty (with purchase_order_id if provided)
        sqlx::query(
            r#"
            INSERT INTO movements
                (product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, NULL, $2, $3, 'entry', $4, $5, $6, $7, 'purchase_receive', $8)
            "#,
        )
        .bind(product_id)
        .bind(location_id)
        .bind(good_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(lot_number)
        .bind(notes)
        .bind(purchase_order_id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 7. If defect_qty > 0, INSERT movement for defect qty
    if defect_qty > 0.0 {
        sqlx::query(
            r#"
            INSERT INTO movements
                (product_id, from_location_id, to_location_id, quantity,
                 movement_type, user_id, supplier_id, reference, notes, movement_reason,
                 purchase_order_id)
            VALUES ($1, NULL, $2, $3, 'entry', $4, $5, $6, $7, 'quality_reject', $8)
            "#,
        )
        .bind(product_id)
        .bind(location_id)
        .bind(defect_qty)
        .bind(user_id)
        .bind(supplier_id)
        .bind(lot_number)
        .bind(notes)
        .bind(purchase_order_id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 8. If linked to a PO line: verify status, update quantity_received, recalculate PO status
    if let (Some(line_id), Some(po_id)) = (purchase_order_line_id, purchase_order_id) {
        // Verify the PO is in a receivable status
        let po_status: Option<(String,)> = sqlx::query_as(
            "SELECT status::text FROM purchase_orders WHERE id = $1",
        )
        .bind(po_id)
        .fetch_optional(&mut *tx)
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

        // Update quantity_received on the line
        sqlx::query(
            r#"
            UPDATE purchase_order_lines
            SET quantity_received = quantity_received + $2
            WHERE id = $1
            "#,
        )
        .bind(line_id)
        .bind(good_qty)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Recalculate PO status
        recalculate_po_status_in_tx(&mut tx, po_id)
            .await
            .map_err(map_sqlx_error)?;

        // 9. Link the lot to the PO line
        sqlx::query(
            "UPDATE product_lots SET purchase_order_line_id = $2 WHERE id = $1",
        )
        .bind(lot_id)
        .bind(line_id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    // 10. Return the lot
    let lot = sqlx::query_as::<_, ProductLotRow>(
        r#"
        SELECT id, product_id, lot_number, batch_date, expiration_date,
               supplier_id, received_quantity::float8, quality_status,
               notes, purchase_order_line_id, created_at, updated_at
        FROM product_lots
        WHERE id = $1
        "#,
    )
    .bind(lot_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(lot)
}
