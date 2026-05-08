//! Purchase orders repository — free functions.
//!
//! Phase B batch 6 (multi-tenant-foundation, design §5.4) collapsed the
//! `PurchaseOrderRepository` trait + `PgPurchaseOrderRepository` struct
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
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::PurchaseOrderStatus;
use vandepot_domain::models::purchase_order::PurchaseOrder;
use vandepot_domain::models::purchase_order_line::PurchaseOrderLine;

use super::shared::map_sqlx_error;

// ── Filter struct (moved from retired ports/purchase_order_repository) ──

pub struct PurchaseOrderFilters {
    pub status: Option<PurchaseOrderStatus>,
    pub supplier_id: Option<Uuid>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
}

// ── Row structs ──────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PurchaseOrderRow {
    id: Uuid,
    tenant_id: Uuid,
    supplier_id: Uuid,
    supplier_name: Option<String>,
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
            tenant_id: row.tenant_id,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
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
    tenant_id: Uuid,
    purchase_order_id: Uuid,
    product_id: Uuid,
    product_name: Option<String>,
    product_sku: Option<String>,
    quantity_ordered: f64,
    quantity_received: f64,
    unit_price: f64,
    notes: Option<String>,
}

impl From<PurchaseOrderLineRow> for PurchaseOrderLine {
    fn from(row: PurchaseOrderLineRow) -> Self {
        PurchaseOrderLine {
            id: row.id,
            tenant_id: row.tenant_id,
            purchase_order_id: row.purchase_order_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            quantity_ordered: row.quantity_ordered,
            quantity_received: row.quantity_received,
            unit_price: row.unit_price,
            notes: row.notes,
        }
    }
}

const PO_COLUMNS: &str = r#"
    id, tenant_id, supplier_id, NULL::text AS supplier_name, order_number,
    status,
    total_amount::float8 AS total_amount,
    expected_delivery_date, notes, created_by, created_at, updated_at
"#;

const PO_LINE_COLUMNS: &str = r#"
    id, tenant_id, purchase_order_id, product_id,
    NULL::text AS product_name,
    NULL::text AS product_sku,
    quantity_ordered::float8 AS quantity_ordered,
    quantity_received::float8 AS quantity_received,
    unit_price::float8 AS unit_price,
    notes
"#;

// ── Shared transaction helper ────────────────────────────────────────

/// Recalculates and persists PO status inside an existing transaction.
/// Logic per spec FR-3.4:
///   - All lines received >= ordered → completed
///   - At least one line partially received → partially_received
///   - All zero → sent (fallback)
///
/// Tenant-scoped: caller passes the row's tenant_id; the SUM aggregates
/// only that tenant's lines (defense-in-depth — composite FK already
/// rejects cross-tenant lines at INSERT time).
pub async fn recalculate_po_status_in_tx(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    po_id: Uuid,
) -> Result<(), sqlx::Error> {
    let row: (Option<f64>, Option<f64>) = sqlx::query_as(
        r#"
        SELECT
            SUM(quantity_ordered)::float8,
            SUM(quantity_received)::float8
        FROM purchase_order_lines
        WHERE purchase_order_id = $1 AND tenant_id = $2
        "#,
    )
    .bind(po_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
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
        "UPDATE purchase_orders SET status = $1::purchase_order_status, updated_at = NOW() \
         WHERE id = $2 AND tenant_id = $3",
    )
    .bind(new_status)
    .bind(po_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

// ── Queries ──────────────────────────────────────────────────────────
//
// Cross-tenant FK violations on supplier_id / product_id surface as
// `DomainError::Conflict` (mapped from PG SQLSTATE 23503 by `map_sqlx_error`)
// → 409. Application probes (e.g. supplier_repo::find_by_id) resolve
// cross-tenant ids to NotFound BEFORE the FK fires; the FK is the DB-layer
// backstop.

pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    supplier_id: Uuid,
    order_number: &str,
    expected_delivery_date: Option<NaiveDate>,
    notes: Option<&str>,
    created_by: Uuid,
) -> Result<PurchaseOrder, DomainError> {
    let sql = format!(
        r#"
        INSERT INTO purchase_orders
            (tenant_id, supplier_id, order_number, status, expected_delivery_date, notes, created_by)
        VALUES ($1, $2, $3, 'draft', $4, $5, $6)
        RETURNING {}
        "#,
        PO_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(tenant_id)
        .bind(supplier_id)
        .bind(order_number)
        .bind(expected_delivery_date)
        .bind(notes)
        .bind(created_by)
        .fetch_one(&mut *conn)
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
                        // Composite FK rejection (cross-tenant supplier_id) →
                        // 409. The `purchase_orders_supplier_tenant_fk`
                        // constraint name leaks here, but the application
                        // probe should have surfaced a NotFound first.
                        "23503" => {
                            return DomainError::Conflict(
                                "Supplier does not belong to this tenant".to_string(),
                            )
                        }
                        _ => {}
                    }
                }
            }
            map_sqlx_error(err)
        })?;

    Ok(PurchaseOrder::from(row))
}

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<PurchaseOrder>, DomainError> {
    let sql = format!(
        "SELECT {} FROM purchase_orders WHERE id = $1 AND tenant_id = $2",
        PO_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(PurchaseOrder::from))
}

pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    filters: PurchaseOrderFilters,
    limit: i64,
    offset: i64,
) -> Result<(Vec<PurchaseOrder>, i64), DomainError> {
    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM purchase_orders
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR supplier_id = $2)
          AND ($3::purchase_order_status IS NULL OR status = $3)
          AND ($4::date IS NULL OR created_at::date >= $4)
          AND ($5::date IS NULL OR created_at::date <= $5)
        "#,
    )
    .bind(tenant_id)
    .bind(filters.supplier_id)
    .bind(filters.status.as_ref())
    .bind(filters.from_date)
    .bind(filters.to_date)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let sql = r#"
        SELECT
            po.id, po.tenant_id, po.supplier_id, s.name AS supplier_name, po.order_number,
            po.status,
            po.total_amount::float8 AS total_amount,
            po.expected_delivery_date, po.notes, po.created_by, po.created_at, po.updated_at
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
        WHERE po.tenant_id = $1
          AND ($2::uuid IS NULL OR po.supplier_id = $2)
          AND ($3::purchase_order_status IS NULL OR po.status = $3)
          AND ($4::date IS NULL OR po.created_at::date >= $4)
          AND ($5::date IS NULL OR po.created_at::date <= $5)
        ORDER BY po.created_at DESC
        LIMIT $6 OFFSET $7
        "#
    .to_string();

    let rows = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(tenant_id)
        .bind(filters.supplier_id)
        .bind(filters.status)
        .bind(filters.from_date)
        .bind(filters.to_date)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    expected_delivery_date: Option<Option<NaiveDate>>,
    notes: Option<Option<&str>>,
) -> Result<PurchaseOrder, DomainError> {
    let sql = format!(
        r#"
        UPDATE purchase_orders
        SET expected_delivery_date = CASE WHEN $3 THEN $4 ELSE expected_delivery_date END,
            notes = CASE WHEN $5 THEN $6 ELSE notes END,
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'draft'
        RETURNING {}
        "#,
        PO_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(expected_delivery_date.is_some())
        .bind(expected_delivery_date.flatten())
        .bind(notes.is_some())
        .bind(notes.flatten())
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    match row {
        Some(r) => Ok(PurchaseOrder::from(r)),
        None => Err(DomainError::Conflict(
            "Cannot update: order not found or not in draft status".to_string(),
        )),
    }
}

pub async fn send(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<PurchaseOrder, DomainError> {
    // Verify at least one line exists (tenant-scoped count).
    let line_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
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
        WHERE id = $1 AND tenant_id = $2 AND status = 'draft'
        RETURNING {}
        "#,
        PO_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    match row {
        Some(r) => Ok(PurchaseOrder::from(r)),
        None => Err(DomainError::Conflict(
            "Cannot send: order not found or not in draft status".to_string(),
        )),
    }
}

pub async fn cancel(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<PurchaseOrder, DomainError> {
    let sql = format!(
        r#"
        UPDATE purchase_orders
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status != 'completed'
        RETURNING {}
        "#,
        PO_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    match row {
        Some(r) => Ok(PurchaseOrder::from(r)),
        None => {
            // Tenant-scoped existence check: completed → 409, missing → 404.
            let exists: Option<(String,)> = sqlx::query_as(
                "SELECT status::text FROM purchase_orders WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
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

// ── Line methods ─────────────────────────────────────────────────────

pub async fn add_line(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    purchase_order_id: Uuid,
    product_id: Uuid,
    quantity_ordered: f64,
    unit_price: f64,
    notes: Option<&str>,
) -> Result<PurchaseOrderLine, DomainError> {
    let sql = format!(
        r#"
        INSERT INTO purchase_order_lines
            (tenant_id, purchase_order_id, product_id, quantity_ordered, unit_price, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {}
        "#,
        PO_LINE_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderLineRow>(&sql)
        .bind(tenant_id)
        .bind(purchase_order_id)
        .bind(product_id)
        .bind(quantity_ordered)
        .bind(unit_price)
        .bind(notes)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| {
            if let sqlx::Error::Database(ref db_err) = err {
                if let Some(code) = db_err.code() {
                    match code.as_ref() {
                        "23505" => {
                            return DomainError::Conflict(
                                "Product already exists in this order".to_string(),
                            );
                        }
                        // Cross-tenant product_id (composite FK rejection)
                        // → 409. Same shape as other batches.
                        "23503" => {
                            return DomainError::Conflict(
                                "Product or order does not belong to this tenant".to_string(),
                            );
                        }
                        _ => {}
                    }
                }
            }
            map_sqlx_error(err)
        })?;

    // Recalculate total_amount on the PO (tenant-scoped).
    sqlx::query(
        r#"
        UPDATE purchase_orders
        SET total_amount = (
            SELECT SUM(quantity_ordered * unit_price)
            FROM purchase_order_lines
            WHERE purchase_order_id = $1 AND tenant_id = $2
        ),
        updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(purchase_order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(PurchaseOrderLine::from(row))
}

pub async fn update_line(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    line_id: Uuid,
    quantity_ordered: Option<f64>,
    unit_price: Option<f64>,
    notes: Option<Option<&str>>,
) -> Result<PurchaseOrderLine, DomainError> {
    // Tenant-scoped existence + status check.
    let line: Option<(f64, Uuid)> = sqlx::query_as(
        "SELECT quantity_received::float8, purchase_order_id \
         FROM purchase_order_lines WHERE id = $1 AND tenant_id = $2",
    )
    .bind(line_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
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
        SET quantity_ordered = COALESCE($3, quantity_ordered),
            unit_price = COALESCE($4, unit_price),
            notes = CASE WHEN $5 THEN $6 ELSE notes END
        WHERE id = $1 AND tenant_id = $2
        RETURNING {}
        "#,
        PO_LINE_COLUMNS
    );

    let row = sqlx::query_as::<_, PurchaseOrderLineRow>(&sql)
        .bind(line_id)
        .bind(tenant_id)
        .bind(quantity_ordered)
        .bind(unit_price)
        .bind(notes.is_some())
        .bind(notes.flatten())
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    // Recalculate total_amount (tenant-scoped).
    sqlx::query(
        r#"
        UPDATE purchase_orders
        SET total_amount = (
            SELECT SUM(quantity_ordered * unit_price)
            FROM purchase_order_lines
            WHERE purchase_order_id = $1 AND tenant_id = $2
        ),
        updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(po_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(PurchaseOrderLine::from(row))
}

pub async fn delete_line(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    line_id: Uuid,
) -> Result<(), DomainError> {
    let line: Option<(f64, Uuid)> = sqlx::query_as(
        "SELECT quantity_received::float8, purchase_order_id \
         FROM purchase_order_lines WHERE id = $1 AND tenant_id = $2",
    )
    .bind(line_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
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

    sqlx::query("DELETE FROM purchase_order_lines WHERE id = $1 AND tenant_id = $2")
        .bind(line_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    // Recalculate total_amount (tenant-scoped).
    sqlx::query(
        r#"
        UPDATE purchase_orders
        SET total_amount = (
            SELECT SUM(quantity_ordered * unit_price)
            FROM purchase_order_lines
            WHERE purchase_order_id = $1 AND tenant_id = $2
        ),
        updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(po_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

pub async fn get_lines(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    purchase_order_id: Uuid,
) -> Result<Vec<PurchaseOrderLine>, DomainError> {
    let rows = sqlx::query_as::<_, PurchaseOrderLineRow>(
        r#"
        SELECT
            pol.id, pol.tenant_id, pol.purchase_order_id, pol.product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            pol.quantity_ordered::float8 AS quantity_ordered,
            pol.quantity_received::float8 AS quantity_received,
            pol.unit_price::float8 AS unit_price,
            pol.notes
        FROM purchase_order_lines pol
        LEFT JOIN products p ON p.id = pol.product_id AND p.tenant_id = pol.tenant_id
        WHERE pol.purchase_order_id = $1 AND pol.tenant_id = $2
        ORDER BY pol.id
        "#,
    )
    .bind(purchase_order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows.into_iter().map(Into::into).collect())
}
