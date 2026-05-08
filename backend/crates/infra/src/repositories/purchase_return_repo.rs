//! Purchase returns repository — free functions.
//!
//! Phase B batch 6 (multi-tenant-foundation, design §5.4) collapsed the
//! `PurchaseReturnRepository` trait + `PgPurchaseReturnRepository` struct
//! into the canonical tenant-aware free-function shape established by
//! B1..B5:
//!   * Read functions take `(&mut PgConnection, tenant_id, ...)`.
//!   * Write functions that begin their own tx take `(&PgPool, tenant_id, ...)`.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N`. The
//! composite FKs installed by 20260508000006 reject any cross-tenant
//! INSERT/UPDATE at the DB layer, so the predicate is belt-and-suspenders.
//!
//! Identity correctness: `find_by_id` filters on BOTH `id` and
//! `tenant_id`; cross-tenant probes resolve to `None` (404 in handlers)
//! rather than leaking existence.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{PurchaseReturnReason, PurchaseReturnStatus};
use vandepot_domain::models::purchase_return::{PurchaseReturn, PurchaseReturnItem};

use super::shared::map_sqlx_error;

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PurchaseReturnRow {
    id: Uuid,
    tenant_id: Uuid,
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
            tenant_id: row.tenant_id,
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
    tenant_id: Uuid,
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
            tenant_id: row.tenant_id,
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
    id, tenant_id, purchase_order_id, return_number,
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
    id, tenant_id, purchase_return_id, product_id,
    quantity_returned::float8 AS quantity_returned,
    quantity_original::float8 AS quantity_original,
    unit_price::float8 AS unit_price,
    subtotal::float8 AS subtotal
"#;

// ── Queries ──────────────────────────────────────────────────────────

pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    po_id: Uuid,
    return_number: &str,
    reason: PurchaseReturnReason,
    reason_notes: Option<&str>,
    decrease_inventory: bool,
    refund_amount: Option<f64>,
    requested_by: Uuid,
    items: Vec<(Uuid, f64, f64, f64)>,
) -> Result<PurchaseReturn, DomainError> {

    // Insert the return header.
    let insert_sql = format!(
        r#"
        INSERT INTO purchase_returns
            (tenant_id, purchase_order_id, return_number, status, reason, reason_notes,
             refund_amount, decrease_inventory, requested_by_id)
        VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
        RETURNING {}
        "#,
        PR_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseReturnRow>(&insert_sql)
        .bind(tenant_id)
        .bind(po_id)
        .bind(return_number)
        .bind(&reason)
        .bind(reason_notes)
        .bind(refund_amount)
        .bind(decrease_inventory)
        .bind(requested_by)
        .fetch_one(&mut *conn)
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
                        // Cross-tenant purchase_order_id (composite FK
                        // rejection) → 409.
                        "23503" => {
                            return DomainError::Conflict(
                                "Purchase order does not belong to this tenant".to_string(),
                            )
                        }
                        _ => {}
                    }
                }
            }
            map_sqlx_error(err)
        })?;

    let return_id = row.id;

    // Insert items (each carries tenant_id).
    for (product_id, qty_returned, qty_original, unit_price) in &items {
        let item_subtotal = qty_returned * unit_price;
        sqlx::query(
            r#"
            INSERT INTO purchase_return_items
                (tenant_id, purchase_return_id, product_id, quantity_returned, quantity_original,
                 unit_price, subtotal)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(tenant_id)
        .bind(return_id)
        .bind(product_id)
        .bind(qty_returned)
        .bind(qty_original)
        .bind(unit_price)
        .bind(item_subtotal)
        .execute(&mut *conn)
        .await
        .map_err(|err| {
            if let sqlx::Error::Database(ref db_err) = err {
                if let Some(code) = db_err.code() {
                    match code.as_ref() {
                        "23505" => {
                            return DomainError::Conflict(
                                "Duplicate product in return items".to_string(),
                            );
                        }
                        // Cross-tenant product_id (composite FK rejection)
                        // → 409.
                        "23503" => {
                            return DomainError::Conflict(
                                "Product does not belong to this tenant".to_string(),
                            );
                        }
                        _ => {}
                    }
                }
            }
            map_sqlx_error(err)
        })?;
    }

    // Recalculate subtotal and total from items (tenant-scoped).
    let update_sql = format!(
        r#"
        UPDATE purchase_returns
        SET subtotal = (
                SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items
                WHERE purchase_return_id = $1 AND tenant_id = $2
            ),
            total = (
                SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items
                WHERE purchase_return_id = $1 AND tenant_id = $2
            ),
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING {}
        "#,
        PR_COLUMNS
    );

    let updated = sqlx::query_as::<_, PurchaseReturnRow>(&update_sql)
        .bind(return_id)
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;


    Ok(PurchaseReturn::from(updated))
}

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<PurchaseReturn>, DomainError> {
    let sql = format!(
        "SELECT {} FROM purchase_returns WHERE id = $1 AND tenant_id = $2",
        PR_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(PurchaseReturn::from))
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    po_id: Option<Uuid>,
    status: Option<PurchaseReturnStatus>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<PurchaseReturn>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM purchase_returns
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR purchase_order_id = $2)
          AND ($3::purchase_return_status IS NULL OR status = $3)
        "#,
    )
    .bind(tenant_id)
    .bind(po_id)
    .bind(status.as_ref())
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let sql = format!(
        r#"
        SELECT {}
        FROM purchase_returns
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR purchase_order_id = $2)
          AND ($3::purchase_return_status IS NULL OR status = $3)
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
        PR_COLUMNS
    );

    let rows = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
        .bind(tenant_id)
        .bind(po_id)
        .bind(status)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn update_status(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    status: PurchaseReturnStatus,
    refund_amount: Option<f64>,
) -> Result<PurchaseReturn, DomainError> {
    // Tenant-scoped existence + status check.
    let current: Option<(PurchaseReturnStatus,)> = sqlx::query_as(
        r#"SELECT status FROM purchase_returns WHERE id = $1 AND tenant_id = $2"#,
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
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
        SET status = $3,
            refund_amount = COALESCE($4, refund_amount),
            shipped_at  = CASE WHEN $3 = 'shipped_to_supplier' THEN NOW() ELSE shipped_at END,
            refunded_at = CASE WHEN $3 = 'refunded'            THEN NOW() ELSE refunded_at END,
            rejected_at = CASE WHEN $3 = 'rejected'            THEN NOW() ELSE rejected_at END,
            updated_at  = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING {}
        "#,
        PR_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseReturnRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(&status)
        .bind(refund_amount)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(PurchaseReturn::from(row))
}

pub async fn delete(conn: &mut PgConnection, tenant_id: Uuid, id: Uuid) -> Result<(), DomainError> {
    // Only pending returns can be deleted (tenant-scoped).
    let current: Option<(PurchaseReturnStatus,)> = sqlx::query_as(
        r#"SELECT status FROM purchase_returns WHERE id = $1 AND tenant_id = $2"#,
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let (current_status,) = current
        .ok_or_else(|| DomainError::NotFound("Purchase return not found".to_string()))?;

    if current_status != PurchaseReturnStatus::Pending {
        return Err(DomainError::Conflict(
            "Only pending returns can be deleted".to_string(),
        ));
    }

    sqlx::query("DELETE FROM purchase_returns WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(())
}

pub async fn get_items(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    return_id: Uuid,
) -> Result<Vec<PurchaseReturnItem>, DomainError> {
    let sql = format!(
        r#"
        SELECT {}
        FROM purchase_return_items
        WHERE purchase_return_id = $1 AND tenant_id = $2
        ORDER BY id
        "#,
        PR_ITEM_COLUMNS
    );

    let rows = sqlx::query_as::<_, PurchaseReturnItemRow>(&sql)
        .bind(return_id)
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn get_already_returned(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    po_id: Uuid,
    product_id: Uuid,
) -> Result<f64, DomainError> {
    let result: (f64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(SUM(pri.quantity_returned), 0)::float8
        FROM purchase_return_items pri
        JOIN purchase_returns pr ON pr.id = pri.purchase_return_id AND pr.tenant_id = pri.tenant_id
        WHERE pr.purchase_order_id = $1
          AND pri.product_id = $2
          AND pr.tenant_id = $3
          AND pr.status != 'rejected'
        "#,
    )
    .bind(po_id)
    .bind(product_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(result.0)
}
