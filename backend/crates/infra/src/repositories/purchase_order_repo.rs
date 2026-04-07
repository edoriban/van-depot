use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::PurchaseOrderStatus;
use vandepot_domain::models::purchase_order::PurchaseOrder;
use vandepot_domain::models::purchase_order_line::PurchaseOrderLine;
use vandepot_domain::ports::purchase_order_repository::{
    PurchaseOrderFilters, PurchaseOrderRepository,
};

use super::shared::map_sqlx_error;

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PurchaseOrderRow {
    id: Uuid,
    supplier_id: Uuid,
    order_number: String,
    status: PurchaseOrderStatus,
    total_amount: Option<f64>,
    expected_delivery_date: Option<NaiveDate>,
    notes: Option<String>,
    created_by: Uuid,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<PurchaseOrderRow> for PurchaseOrder {
    fn from(row: PurchaseOrderRow) -> Self {
        PurchaseOrder {
            id: row.id,
            supplier_id: row.supplier_id,
            order_number: row.order_number,
            status: row.status,
            total_amount: row.total_amount,
            expected_delivery_date: row.expected_delivery_date,
            notes: row.notes,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct PurchaseOrderLineRow {
    id: Uuid,
    purchase_order_id: Uuid,
    product_id: Uuid,
    quantity_ordered: f64,
    quantity_received: f64,
    unit_price: f64,
    notes: Option<String>,
}

impl From<PurchaseOrderLineRow> for PurchaseOrderLine {
    fn from(row: PurchaseOrderLineRow) -> Self {
        PurchaseOrderLine {
            id: row.id,
            purchase_order_id: row.purchase_order_id,
            product_id: row.product_id,
            quantity_ordered: row.quantity_ordered,
            quantity_received: row.quantity_received,
            unit_price: row.unit_price,
            notes: row.notes,
        }
    }
}

const PO_COLUMNS: &str = r#"
    id, supplier_id, order_number,
    status AS "status: PurchaseOrderStatus",
    total_amount::float8 AS total_amount,
    expected_delivery_date, notes, created_by, created_at, updated_at
"#;

const PO_LINE_COLUMNS: &str = r#"
    id, purchase_order_id, product_id,
    quantity_ordered::float8 AS quantity_ordered,
    quantity_received::float8 AS quantity_received,
    unit_price::float8 AS unit_price,
    notes
"#;

// ── Repository struct ────────────────────────────────────────────────

pub struct PgPurchaseOrderRepository {
    pub pool: PgPool,
}

impl PgPurchaseOrderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

// ── Shared transaction helper ────────────────────────────────────────

/// Recalculates and persists PO status inside an existing transaction.
/// Logic per spec FR-3.4:
///   - All lines received >= ordered → completed
///   - At least one line partially received → partially_received
///   - All zero → sent (fallback)
pub async fn recalculate_po_status_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    po_id: Uuid,
) -> Result<(), sqlx::Error> {
    let row: (Option<f64>, Option<f64>) = sqlx::query_as(
        r#"
        SELECT
            SUM(quantity_ordered)::float8,
            SUM(quantity_received)::float8
        FROM purchase_order_lines
        WHERE purchase_order_id = $1
        "#,
    )
    .bind(po_id)
    .fetch_one(&mut **tx)
    .await?;

    let total_ordered = row.0.unwrap_or(0.0);
    let total_received = row.1.unwrap_or(0.0);

    let new_status = if total_received <= 0.0 {
        "sent"
    } else if total_received >= total_ordered {
        "completed"
    } else {
        "partially_received"
    };

    sqlx::query(
        "UPDATE purchase_orders SET status = $1::purchase_order_status, updated_at = NOW() WHERE id = $2",
    )
    .bind(new_status)
    .bind(po_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ── Trait implementation ─────────────────────────────────────────────

#[async_trait]
impl PurchaseOrderRepository for PgPurchaseOrderRepository {
    // ── T09: CRUD + lifecycle ────────────────────────────────────────

    async fn create(
        &self,
        supplier_id: Uuid,
        order_number: &str,
        expected_delivery_date: Option<NaiveDate>,
        notes: Option<&str>,
        created_by: Uuid,
    ) -> Result<PurchaseOrder, DomainError> {
        let sql = format!(
            r#"
            INSERT INTO purchase_orders
                (supplier_id, order_number, status, expected_delivery_date, notes, created_by)
            VALUES ($1, $2, 'draft', $3, $4, $5)
            RETURNING {}
            "#,
            PO_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(supplier_id)
            .bind(order_number)
            .bind(expected_delivery_date)
            .bind(notes)
            .bind(created_by)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| {
                if let sqlx::Error::Database(ref db_err) = err {
                    if let Some(code) = db_err.code() {
                        match code.as_ref() {
                            "23505" => {
                                return DomainError::Duplicate(
                                    "Order number already exists".to_string(),
                                )
                            }
                            "23503" => {
                                return DomainError::NotFound("Supplier not found".to_string())
                            }
                            _ => {}
                        }
                    }
                }
                map_sqlx_error(err)
            })?;

        Ok(PurchaseOrder::from(row))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<PurchaseOrder>, DomainError> {
        let sql = format!(
            "SELECT {} FROM purchase_orders WHERE id = $1",
            PO_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(PurchaseOrder::from))
    }

    async fn list(
        &self,
        filters: PurchaseOrderFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PurchaseOrder>, i64), DomainError> {
        // Count query
        let total: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM purchase_orders
            WHERE ($1::uuid IS NULL OR supplier_id = $1)
              AND ($2::purchase_order_status IS NULL OR status = $2)
              AND ($3::date IS NULL OR created_at::date >= $3)
              AND ($4::date IS NULL OR created_at::date <= $4)
            "#,
        )
        .bind(filters.supplier_id)
        .bind(filters.status.as_ref())
        .bind(filters.from_date)
        .bind(filters.to_date)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let sql = format!(
            r#"
            SELECT {}
            FROM purchase_orders
            WHERE ($1::uuid IS NULL OR supplier_id = $1)
              AND ($2::purchase_order_status IS NULL OR status = $2)
              AND ($3::date IS NULL OR created_at::date >= $3)
              AND ($4::date IS NULL OR created_at::date <= $4)
            ORDER BY created_at DESC
            LIMIT $5 OFFSET $6
            "#,
            PO_COLUMNS
        );

        let rows = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(filters.supplier_id)
            .bind(filters.status)
            .bind(filters.from_date)
            .bind(filters.to_date)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn update(
        &self,
        id: Uuid,
        expected_delivery_date: Option<Option<NaiveDate>>,
        notes: Option<Option<&str>>,
    ) -> Result<PurchaseOrder, DomainError> {
        let sql = format!(
            r#"
            UPDATE purchase_orders
            SET expected_delivery_date = CASE WHEN $2 THEN $3 ELSE expected_delivery_date END,
                notes = CASE WHEN $4 THEN $5 ELSE notes END,
                updated_at = NOW()
            WHERE id = $1 AND status = 'draft'
            RETURNING {}
            "#,
            PO_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(id)
            .bind(expected_delivery_date.is_some())
            .bind(expected_delivery_date.flatten())
            .bind(notes.is_some())
            .bind(notes.flatten())
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        match row {
            Some(r) => Ok(PurchaseOrder::from(r)),
            None => Err(DomainError::Conflict(
                "Cannot update: order not found or not in draft status".to_string(),
            )),
        }
    }

    async fn send(&self, id: Uuid) -> Result<PurchaseOrder, DomainError> {
        // Verify at least one line exists
        let line_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if line_count.0 == 0 {
            return Err(DomainError::Validation(
                "Order must have at least one line before being sent".to_string(),
            ));
        }

        let sql = format!(
            r#"
            UPDATE purchase_orders
            SET status = 'sent', updated_at = NOW()
            WHERE id = $1 AND status = 'draft'
            RETURNING {}
            "#,
            PO_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        match row {
            Some(r) => Ok(PurchaseOrder::from(r)),
            None => Err(DomainError::Conflict(
                "Cannot send: order not found or not in draft status".to_string(),
            )),
        }
    }

    async fn cancel(&self, id: Uuid) -> Result<PurchaseOrder, DomainError> {
        let sql = format!(
            r#"
            UPDATE purchase_orders
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND status != 'completed'
            RETURNING {}
            "#,
            PO_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        match row {
            Some(r) => Ok(PurchaseOrder::from(r)),
            None => {
                // Check if it exists but is completed, or simply not found
                let exists: Option<(String,)> = sqlx::query_as(
                    "SELECT status::text FROM purchase_orders WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

                match exists {
                    Some(_) => Err(DomainError::Conflict(
                        "Cannot cancel a completed order".to_string(),
                    )),
                    None => Err(DomainError::NotFound("Purchase order not found".to_string())),
                }
            }
        }
    }

    // ── T10: Line methods ────────────────────────────────────────────

    async fn add_line(
        &self,
        purchase_order_id: Uuid,
        product_id: Uuid,
        quantity_ordered: f64,
        unit_price: f64,
        notes: Option<&str>,
    ) -> Result<PurchaseOrderLine, DomainError> {
        let sql = format!(
            r#"
            INSERT INTO purchase_order_lines
                (purchase_order_id, product_id, quantity_ordered, unit_price, notes)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING {}
            "#,
            PO_LINE_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderLineRow>(&sql)
            .bind(purchase_order_id)
            .bind(product_id)
            .bind(quantity_ordered)
            .bind(unit_price)
            .bind(notes)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| {
                if let sqlx::Error::Database(ref db_err) = err {
                    if let Some(code) = db_err.code() {
                        if code.as_ref() == "23505" {
                            return DomainError::Conflict(
                                "Product already exists in this order".to_string(),
                            );
                        }
                    }
                }
                map_sqlx_error(err)
            })?;

        // Recalculate total_amount on the PO
        sqlx::query(
            r#"
            UPDATE purchase_orders
            SET total_amount = (
                SELECT SUM(quantity_ordered * unit_price)
                FROM purchase_order_lines
                WHERE purchase_order_id = $1
            ),
            updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(purchase_order_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(PurchaseOrderLine::from(row))
    }

    async fn update_line(
        &self,
        line_id: Uuid,
        quantity_ordered: Option<f64>,
        unit_price: Option<f64>,
        notes: Option<Option<&str>>,
    ) -> Result<PurchaseOrderLine, DomainError> {
        // Check quantity_received == 0
        let line: Option<(f64, Uuid)> = sqlx::query_as(
            "SELECT quantity_received::float8, purchase_order_id FROM purchase_order_lines WHERE id = $1",
        )
        .bind(line_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let (qty_received, po_id) = match line {
            Some(l) => l,
            None => return Err(DomainError::NotFound("Line not found".to_string())),
        };

        if qty_received > 0.0 {
            return Err(DomainError::Conflict(
                "Cannot update a line that already has received quantities".to_string(),
            ));
        }

        let sql = format!(
            r#"
            UPDATE purchase_order_lines
            SET quantity_ordered = COALESCE($2, quantity_ordered),
                unit_price = COALESCE($3, unit_price),
                notes = CASE WHEN $4 THEN $5 ELSE notes END
            WHERE id = $1
            RETURNING {}
            "#,
            PO_LINE_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseOrderLineRow>(&sql)
            .bind(line_id)
            .bind(quantity_ordered)
            .bind(unit_price)
            .bind(notes.is_some())
            .bind(notes.flatten())
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        // Recalculate total_amount
        sqlx::query(
            r#"
            UPDATE purchase_orders
            SET total_amount = (
                SELECT SUM(quantity_ordered * unit_price)
                FROM purchase_order_lines
                WHERE purchase_order_id = $1
            ),
            updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(po_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(PurchaseOrderLine::from(row))
    }

    async fn delete_line(&self, line_id: Uuid) -> Result<(), DomainError> {
        // Check quantity_received == 0
        let line: Option<(f64, Uuid)> = sqlx::query_as(
            "SELECT quantity_received::float8, purchase_order_id FROM purchase_order_lines WHERE id = $1",
        )
        .bind(line_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let (qty_received, po_id) = match line {
            Some(l) => l,
            None => return Err(DomainError::NotFound("Line not found".to_string())),
        };

        if qty_received > 0.0 {
            return Err(DomainError::Conflict(
                "Cannot delete a line that already has received quantities".to_string(),
            ));
        }

        sqlx::query("DELETE FROM purchase_order_lines WHERE id = $1")
            .bind(line_id)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        // Recalculate total_amount
        sqlx::query(
            r#"
            UPDATE purchase_orders
            SET total_amount = (
                SELECT SUM(quantity_ordered * unit_price)
                FROM purchase_order_lines
                WHERE purchase_order_id = $1
            ),
            updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(po_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn get_lines(
        &self,
        purchase_order_id: Uuid,
    ) -> Result<Vec<PurchaseOrderLine>, DomainError> {
        let sql = format!(
            r#"
            SELECT {}
            FROM purchase_order_lines
            WHERE purchase_order_id = $1
            ORDER BY id
            "#,
            PO_LINE_COLUMNS
        );

        let rows = sqlx::query_as::<_, PurchaseOrderLineRow>(&sql)
            .bind(purchase_order_id)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(Into::into).collect())
    }
}
