use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{PurchaseReturnReason, PurchaseReturnStatus};
use vandepot_domain::models::purchase_return::{PurchaseReturn, PurchaseReturnItem};
use vandepot_domain::ports::purchase_return_repository::PurchaseReturnRepository;

use super::shared::map_sqlx_error;

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PurchaseReturnRow {
    id: Uuid,
    purchase_order_id: Uuid,
    return_number: String,
    status: PurchaseReturnStatus,
    reason: PurchaseReturnReason,
    reason_notes: Option<String>,
    subtotal: f64,
    total: f64,
    refund_amount: Option<f64>,
    decrease_inventory: bool,
    requested_by_id: Uuid,
    shipped_at: Option<DateTime<Utc>>,
    refunded_at: Option<DateTime<Utc>>,
    rejected_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<PurchaseReturnRow> for PurchaseReturn {
    fn from(row: PurchaseReturnRow) -> Self {
        PurchaseReturn {
            id: row.id,
            purchase_order_id: row.purchase_order_id,
            return_number: row.return_number,
            status: row.status,
            reason: row.reason,
            reason_notes: row.reason_notes,
            subtotal: row.subtotal,
            total: row.total,
            refund_amount: row.refund_amount,
            decrease_inventory: row.decrease_inventory,
            requested_by_id: row.requested_by_id,
            shipped_at: row.shipped_at,
            refunded_at: row.refunded_at,
            rejected_at: row.rejected_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct PurchaseReturnItemRow {
    id: Uuid,
    purchase_return_id: Uuid,
    product_id: Uuid,
    quantity_returned: f64,
    quantity_original: f64,
    unit_price: f64,
    subtotal: f64,
}

impl From<PurchaseReturnItemRow> for PurchaseReturnItem {
    fn from(row: PurchaseReturnItemRow) -> Self {
        PurchaseReturnItem {
            id: row.id,
            purchase_return_id: row.purchase_return_id,
            product_id: row.product_id,
            quantity_returned: row.quantity_returned,
            quantity_original: row.quantity_original,
            unit_price: row.unit_price,
            subtotal: row.subtotal,
        }
    }
}

const PR_COLUMNS: &str = r#"
    id, purchase_order_id, return_number,
    status,
    reason,
    reason_notes,
    subtotal::float8 AS subtotal,
    total::float8 AS total,
    refund_amount::float8 AS refund_amount,
    decrease_inventory,
    requested_by_id,
    shipped_at, refunded_at, rejected_at,
    created_at, updated_at
"#;

const PR_ITEM_COLUMNS: &str = r#"
    id, purchase_return_id, product_id,
    quantity_returned::float8 AS quantity_returned,
    quantity_original::float8 AS quantity_original,
    unit_price::float8 AS unit_price,
    subtotal::float8 AS subtotal
"#;

// ── Repository struct ────────────────────────────────────────────────

pub struct PgPurchaseReturnRepository {
    pub pool: PgPool,
}

impl PgPurchaseReturnRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

// ── Trait implementation ─────────────────────────────────────────────

#[async_trait]
impl PurchaseReturnRepository for PgPurchaseReturnRepository {
    async fn create(
        &self,
        po_id: Uuid,
        return_number: &str,
        reason: PurchaseReturnReason,
        reason_notes: Option<&str>,
        decrease_inventory: bool,
        refund_amount: Option<f64>,
        requested_by: Uuid,
        items: Vec<(Uuid, f64, f64, f64)>,
    ) -> Result<PurchaseReturn, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // Insert the return header
        let insert_sql = format!(
            r#"
            INSERT INTO purchase_returns
                (purchase_order_id, return_number, status, reason, reason_notes,
                 refund_amount, decrease_inventory, requested_by_id)
            VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
            RETURNING {}
            "#,
            PR_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseReturnRow>(&insert_sql)
            .bind(po_id)
            .bind(return_number)
            .bind(&reason)
            .bind(reason_notes)
            .bind(refund_amount)
            .bind(decrease_inventory)
            .bind(requested_by)
            .fetch_one(&mut *tx)
            .await
            .map_err(|err| {
                if let sqlx::Error::Database(ref db_err) = err {
                    if let Some(code) = db_err.code() {
                        match code.as_ref() {
                            "23505" => {
                                return DomainError::Duplicate(
                                    "Return number already exists".to_string(),
                                )
                            }
                            "23503" => {
                                return DomainError::NotFound(
                                    "Purchase order not found".to_string(),
                                )
                            }
                            _ => {}
                        }
                    }
                }
                map_sqlx_error(err)
            })?;

        let return_id = row.id;

        // Insert items
        for (product_id, qty_returned, qty_original, unit_price) in &items {
            let item_subtotal = qty_returned * unit_price;
            sqlx::query(
                r#"
                INSERT INTO purchase_return_items
                    (purchase_return_id, product_id, quantity_returned, quantity_original,
                     unit_price, subtotal)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
            )
            .bind(return_id)
            .bind(product_id)
            .bind(qty_returned)
            .bind(qty_original)
            .bind(unit_price)
            .bind(item_subtotal)
            .execute(&mut *tx)
            .await
            .map_err(|err| {
                if let sqlx::Error::Database(ref db_err) = err {
                    if let Some(code) = db_err.code() {
                        if code.as_ref() == "23505" {
                            return DomainError::Conflict(
                                "Duplicate product in return items".to_string(),
                            );
                        }
                    }
                }
                map_sqlx_error(err)
            })?;
        }

        // Recalculate subtotal and total from items
        let update_sql = format!(
            r#"
            UPDATE purchase_returns
            SET subtotal = (
                    SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items
                    WHERE purchase_return_id = $1
                ),
                total = (
                    SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items
                    WHERE purchase_return_id = $1
                ),
                updated_at = NOW()
            WHERE id = $1
            RETURNING {}
            "#,
            PR_COLUMNS
        );

        let updated = sqlx::query_as::<_, PurchaseReturnRow>(&update_sql)
            .bind(return_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(PurchaseReturn::from(updated))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<PurchaseReturn>, DomainError> {
        let sql = format!(
            "SELECT {} FROM purchase_returns WHERE id = $1",
            PR_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(PurchaseReturn::from))
    }

    async fn list(
        &self,
        po_id: Option<Uuid>,
        status: Option<PurchaseReturnStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PurchaseReturn>, i64), DomainError> {
        let total: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM purchase_returns
            WHERE ($1::uuid IS NULL OR purchase_order_id = $1)
              AND ($2::purchase_return_status IS NULL OR status = $2)
            "#,
        )
        .bind(po_id)
        .bind(status.as_ref())
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let sql = format!(
            r#"
            SELECT {}
            FROM purchase_returns
            WHERE ($1::uuid IS NULL OR purchase_order_id = $1)
              AND ($2::purchase_return_status IS NULL OR status = $2)
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
            PR_COLUMNS
        );

        let rows = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
            .bind(po_id)
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn update_status(
        &self,
        id: Uuid,
        status: PurchaseReturnStatus,
        refund_amount: Option<f64>,
    ) -> Result<PurchaseReturn, DomainError> {
        // Check current status first
        let current: Option<(PurchaseReturnStatus,)> = sqlx::query_as(
            r#"SELECT status FROM purchase_returns WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let (current_status,) = current
            .ok_or_else(|| DomainError::NotFound("Purchase return not found".to_string()))?;

        if matches!(
            current_status,
            PurchaseReturnStatus::Refunded | PurchaseReturnStatus::Rejected
        ) {
            return Err(DomainError::Conflict(
                "Cannot update status: return is already in a terminal state (refunded or rejected)"
                    .to_string(),
            ));
        }

        let sql = format!(
            r#"
            UPDATE purchase_returns
            SET status = $2,
                refund_amount = COALESCE($3, refund_amount),
                shipped_at  = CASE WHEN $2 = 'shipped_to_supplier' THEN NOW() ELSE shipped_at END,
                refunded_at = CASE WHEN $2 = 'refunded'            THEN NOW() ELSE refunded_at END,
                rejected_at = CASE WHEN $2 = 'rejected'            THEN NOW() ELSE rejected_at END,
                updated_at  = NOW()
            WHERE id = $1
            RETURNING {}
            "#,
            PR_COLUMNS
        );

        let row = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
            .bind(id)
            .bind(&status)
            .bind(refund_amount)
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(PurchaseReturn::from(row))
    }

    async fn delete(&self, id: Uuid) -> Result<(), DomainError> {
        // Only pending returns can be deleted
        let current: Option<(PurchaseReturnStatus,)> = sqlx::query_as(
            r#"SELECT status FROM purchase_returns WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let (current_status,) = current
            .ok_or_else(|| DomainError::NotFound("Purchase return not found".to_string()))?;

        if current_status != PurchaseReturnStatus::Pending {
            return Err(DomainError::Conflict(
                "Only pending returns can be deleted".to_string(),
            ));
        }

        sqlx::query("DELETE FROM purchase_returns WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn get_items(&self, return_id: Uuid) -> Result<Vec<PurchaseReturnItem>, DomainError> {
        let sql = format!(
            r#"
            SELECT {}
            FROM purchase_return_items
            WHERE purchase_return_id = $1
            ORDER BY id
            "#,
            PR_ITEM_COLUMNS
        );

        let rows = sqlx::query_as::<_, PurchaseReturnItemRow>(&sql)
            .bind(return_id)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn get_already_returned(
        &self,
        po_id: Uuid,
        product_id: Uuid,
    ) -> Result<f64, DomainError> {
        let result: (f64,) = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(pri.quantity_returned), 0)::float8
            FROM purchase_return_items pri
            JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
            WHERE pr.purchase_order_id = $1
              AND pri.product_id = $2
              AND pr.status != 'rejected'
            "#,
        )
        .bind(po_id)
        .bind(product_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(result.0)
    }
}
