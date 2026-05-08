//! Product repository — free functions over `&mut PgConnection`.
//!
//! Phase B batch 2 (multi-tenant-foundation, design §5.4) collapsed the
//! struct-with-pool + trait shape into free functions. Every function takes
//! `&mut PgConnection` as the first parameter and `tenant_id: Uuid` as the
//! second — the canonical signature documented in
//! `sdd/multi-tenant-foundation/apply-progress` (B1 template).
//!
//! Defense-in-depth: every query carries a `WHERE tenant_id = $N` predicate
//! even though Phase C will add Postgres RLS on top. The duplicate check
//! costs effectively nothing (the index `idx_products_tenant` covers it)
//! and protects us during the window between B-end and C-land.
//!
//! Identity correctness: `update`/`soft_delete`/`reclassify` filter on BOTH
//! `id` and `tenant_id`. A leaked or guessed UUID belonging to another
//! tenant resolves to "row not found" rather than mutating the wrong row.

use chrono::{DateTime, Utc};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{ProductClass, UnitType};
use vandepot_domain::models::product::Product;

use super::shared::map_sqlx_error;

/// Snapshot of the blockers that prevent a product's class from being
/// changed. `locked` is a convenience flag equivalent to
/// `movements + lots + tool_instances > 0`.
///
/// Moved here from `domain::ports::product_repository` (which was deleted
/// in Phase B batch 2 — see `domain::ports::mod` doc comment).
#[derive(Debug, Clone, Copy)]
pub struct ClassLockStatus {
    pub locked: bool,
    pub movements: i64,
    pub lots: i64,
    pub tool_instances: i64,
}

#[derive(sqlx::FromRow)]
struct ProductRow {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    sku: String,
    description: Option<String>,
    category_id: Option<Uuid>,
    unit_of_measure: UnitType,
    product_class: ProductClass,
    has_expiry: bool,
    is_manufactured: bool,
    min_stock: f64,
    max_stock: Option<f64>,
    is_active: bool,
    created_by: Option<Uuid>,
    updated_by: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

/// Extended row that includes the email of the user who last updated the product.
#[derive(sqlx::FromRow)]
struct ProductWithAuditRow {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    sku: String,
    description: Option<String>,
    category_id: Option<Uuid>,
    unit_of_measure: UnitType,
    product_class: ProductClass,
    has_expiry: bool,
    is_manufactured: bool,
    min_stock: f64,
    max_stock: Option<f64>,
    is_active: bool,
    created_by: Option<Uuid>,
    updated_by: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    updated_by_email: Option<String>,
    created_by_email: Option<String>,
}

impl From<ProductRow> for Product {
    fn from(row: ProductRow) -> Self {
        Product {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            sku: row.sku,
            description: row.description,
            category_id: row.category_id,
            unit_of_measure: row.unit_of_measure,
            product_class: row.product_class,
            has_expiry: row.has_expiry,
            is_manufactured: row.is_manufactured,
            min_stock: row.min_stock,
            max_stock: row.max_stock,
            is_active: row.is_active,
            created_by: row.created_by,
            updated_by: row.updated_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

impl From<ProductWithAuditRow> for Product {
    fn from(row: ProductWithAuditRow) -> Self {
        Product {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            sku: row.sku,
            description: row.description,
            category_id: row.category_id,
            unit_of_measure: row.unit_of_measure,
            product_class: row.product_class,
            has_expiry: row.has_expiry,
            is_manufactured: row.is_manufactured,
            min_stock: row.min_stock,
            max_stock: row.max_stock,
            is_active: row.is_active,
            created_by: row.created_by,
            updated_by: row.updated_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

/// DTO returned by `find_by_id_with_audit` that includes resolved email addresses.
pub struct ProductWithAudit {
    pub product: Product,
    pub updated_by_email: Option<String>,
    pub created_by_email: Option<String>,
}

const PRODUCT_COLUMNS: &str = "id, tenant_id, name, sku, description, category_id, \
                                unit_of_measure, product_class, has_expiry, is_manufactured, \
                                min_stock::float8, max_stock::float8, is_active, \
                                created_by, updated_by, created_at, updated_at, deleted_at";

/// Count the three blocker kinds that prevent reclassification of a product:
/// movements, product_lots, and tool_instances. Kept in a single helper so
/// `reclassify` and `class_lock_status` stay in sync.
///
/// NOTE: movements/product_lots/tool_instances do not yet carry `tenant_id`
/// (B4..B6). The product_id filter is enough to keep the count tenant-safe
/// because the caller has already proven the product belongs to its tenant
/// (the surrounding `find_by_id` / row lookup is tenant-scoped).
async fn count_class_blockers(
    conn: &mut PgConnection,
    product_id: Uuid,
) -> Result<(i64, i64, i64), DomainError> {
    let movements: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    let lots: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    let tool_instances: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM tool_instances WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_error)?;

    Ok((movements.0, lots.0, tool_instances.0))
}

pub async fn find_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Product>, DomainError> {
    let sql = format!(
        "SELECT {PRODUCT_COLUMNS} FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL"
    );
    let row = sqlx::query_as::<_, ProductRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(Product::from))
}

/// Like `find_by_id` but JOINs users to resolve audit emails.
pub async fn find_by_id_with_audit(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<ProductWithAudit>, DomainError> {
    let sql = "\
        SELECT p.id, p.tenant_id, p.name, p.sku, p.description, p.category_id, p.unit_of_measure, \
               p.product_class, p.has_expiry, p.is_manufactured, \
               p.min_stock::float8, p.max_stock::float8, p.is_active, \
               p.created_by, p.updated_by, \
               p.created_at, p.updated_at, p.deleted_at, \
               uu.email AS updated_by_email, \
               uc.email AS created_by_email \
        FROM products p \
        LEFT JOIN users uu ON uu.id = p.updated_by \
        LEFT JOIN users uc ON uc.id = p.created_by \
        WHERE p.id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL";

    let row = sqlx::query_as::<_, ProductWithAuditRow>(sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(row.map(|r| ProductWithAudit {
        updated_by_email: r.updated_by_email.clone(),
        created_by_email: r.created_by_email.clone(),
        product: Product::from(r),
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn list(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    search: Option<&str>,
    category_id: Option<Uuid>,
    product_class: Option<ProductClass>,
    is_manufactured: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Product>, i64), DomainError> {
    let search_pattern = search.map(|s| format!("%{}%", s));

    // tenant_id is always $1, deleted_at filter, then optional filters with
    // sequential param indices starting at $2.
    let mut where_clauses = vec![
        "tenant_id = $1".to_string(),
        "deleted_at IS NULL".to_string(),
    ];
    let mut idx: usize = 1;

    if search_pattern.is_some() {
        idx += 1;
        where_clauses.push(format!("(name ILIKE ${idx} OR sku ILIKE ${idx})"));
    }
    if category_id.is_some() {
        idx += 1;
        where_clauses.push(format!("category_id = ${idx}"));
    }
    if product_class.is_some() {
        idx += 1;
        where_clauses.push(format!("product_class = ${idx}"));
    }
    if is_manufactured.is_some() {
        idx += 1;
        where_clauses.push(format!("is_manufactured = ${idx}"));
    }

    let where_sql = where_clauses.join(" AND ");

    // Count query (same params minus LIMIT/OFFSET).
    let count_sql = format!("SELECT COUNT(*) FROM products WHERE {where_sql}");
    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql).bind(tenant_id);
    if let Some(ref pat) = search_pattern {
        count_query = count_query.bind(pat);
    }
    if let Some(cid) = category_id {
        count_query = count_query.bind(cid);
    }
    if let Some(ref pc) = product_class {
        count_query = count_query.bind(pc);
    }
    if let Some(im) = is_manufactured {
        count_query = count_query.bind(im);
    }
    let total = count_query
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    // Data query with LIMIT/OFFSET.
    idx += 1;
    let limit_idx = idx;
    idx += 1;
    let offset_idx = idx;

    let data_sql = format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE {where_sql} \
         ORDER BY created_at DESC LIMIT ${limit_idx} OFFSET ${offset_idx}"
    );
    let mut data_query = sqlx::query_as::<_, ProductRow>(&data_sql).bind(tenant_id);
    if let Some(ref pat) = search_pattern {
        data_query = data_query.bind(pat);
    }
    if let Some(cid) = category_id {
        data_query = data_query.bind(cid);
    }
    if let Some(ref pc) = product_class {
        data_query = data_query.bind(pc);
    }
    if let Some(im) = is_manufactured {
        data_query = data_query.bind(im);
    }
    data_query = data_query.bind(limit).bind(offset);

    let rows = data_query
        .fetch_all(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
    sku: &str,
    description: Option<&str>,
    category_id: Option<Uuid>,
    unit_of_measure: UnitType,
    product_class: ProductClass,
    has_expiry: bool,
    is_manufactured: bool,
    min_stock: f64,
    max_stock: Option<f64>,
    created_by: Option<Uuid>,
) -> Result<Product, DomainError> {
    // App-layer invariant check — provides a nicer message than the DB
    // CHECK constraint (which surfaces as a generic sqlx error).
    if matches!(product_class, ProductClass::ToolSpare) && has_expiry {
        return Err(DomainError::Validation(
            "has_expiry must be false for tool_spare products".to_string(),
        ));
    }

    // Cross-field invariant (design §D3, spec §1): `is_manufactured = true`
    // requires `product_class = raw_material`. We pre-validate here for a
    // clean typed error; the DB-layer CHECK is the backstop.
    if is_manufactured && !matches!(product_class, ProductClass::RawMaterial) {
        return Err(DomainError::ProductIsManufacturedRequiresRawMaterial {
            product_id: Uuid::nil(),
        });
    }

    let sql = format!(
        "INSERT INTO products (tenant_id, name, sku, description, category_id, \
                               unit_of_measure, product_class, has_expiry, \
                               is_manufactured, min_stock, max_stock, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
         RETURNING {PRODUCT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, ProductRow>(&sql)
        .bind(tenant_id)
        .bind(name)
        .bind(sku)
        .bind(description)
        .bind(category_id)
        .bind(&unit_of_measure)
        .bind(&product_class)
        .bind(has_expiry)
        .bind(is_manufactured)
        .bind(min_stock)
        .bind(max_stock)
        .bind(created_by)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Product::from(row))
}

#[allow(clippy::too_many_arguments)]
pub async fn update(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    sku: Option<&str>,
    description: Option<Option<&str>>,
    category_id: Option<Option<Uuid>>,
    unit_of_measure: Option<UnitType>,
    has_expiry: Option<bool>,
    is_manufactured: Option<bool>,
    min_stock: Option<f64>,
    max_stock: Option<Option<f64>>,
    updated_by: Option<Uuid>,
) -> Result<Product, DomainError> {
    // Cross-field guard: if the incoming patch flips is_manufactured=true,
    // the resulting product MUST have product_class=raw_material. Mirrors
    // design §D3 / spec §1.
    if let Some(true) = is_manufactured {
        let current: Option<(ProductClass,)> = sqlx::query_as(
            "SELECT product_class FROM products \
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        match current {
            None => return Err(DomainError::NotFound("Product not found".to_string())),
            Some((class,)) if !matches!(class, ProductClass::RawMaterial) => {
                return Err(DomainError::ProductIsManufacturedRequiresRawMaterial {
                    product_id: id,
                });
            }
            _ => {}
        }
    }

    let sql = format!(
        "UPDATE products SET \
            name = COALESCE($3, name), \
            sku = COALESCE($4, sku), \
            description = CASE WHEN $5 THEN $6 ELSE description END, \
            category_id = CASE WHEN $7 THEN $8 ELSE category_id END, \
            unit_of_measure = COALESCE($9, unit_of_measure), \
            has_expiry = COALESCE($10, has_expiry), \
            is_manufactured = COALESCE($11, is_manufactured), \
            min_stock = COALESCE($12, min_stock), \
            max_stock = CASE WHEN $13 THEN $14 ELSE max_stock END, \
            updated_by = COALESCE($15, updated_by), \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL \
         RETURNING {PRODUCT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, ProductRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(name)
        .bind(sku)
        .bind(description.is_some())
        .bind(description.flatten())
        .bind(category_id.is_some())
        .bind(category_id.flatten())
        .bind(unit_of_measure)
        .bind(has_expiry)
        .bind(is_manufactured)
        .bind(min_stock)
        .bind(max_stock.is_some())
        .bind(max_stock.flatten())
        .bind(updated_by)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    Ok(Product::from(row))
}

pub async fn soft_delete(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "UPDATE products SET deleted_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Product not found".to_string()));
    }

    Ok(())
}

pub async fn reclassify(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    new_class: ProductClass,
    updated_by: Option<Uuid>,
) -> Result<Product, DomainError> {
    let mut tx = conn.begin().await.map_err(map_sqlx_error)?;

    // 1. Count blockers. Any nonzero count → refuse to reclassify and
    //    surface the structured `ClassLocked` variant so the API layer
    //    can emit a typed `blocked_by` JSON shape (design §5e).
    let (movements, lots, tool_instances) = count_class_blockers(&mut tx, id).await?;
    if movements + lots + tool_instances > 0 {
        return Err(DomainError::ClassLocked {
            movements,
            lots,
            tool_instances,
        });
    }

    // 2. Fetch current has_expiry + is_manufactured to enforce invariants
    //    with friendlier domain errors (CHECK constraints are the backstop).
    let current: Option<(bool, bool)> = sqlx::query_as(
        "SELECT has_expiry, is_manufactured \
         FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;
    let (has_expiry, is_manufactured) =
        current.ok_or_else(|| DomainError::NotFound("Product not found".to_string()))?;
    if matches!(new_class, ProductClass::ToolSpare) && has_expiry {
        return Err(DomainError::Validation(
            "Cannot reclassify to tool_spare while has_expiry is true".to_string(),
        ));
    }
    if is_manufactured && !matches!(new_class, ProductClass::RawMaterial) {
        return Err(DomainError::ProductIsManufacturedRequiresRawMaterial {
            product_id: id,
        });
    }

    // 3. Apply the update and commit.
    let sql = format!(
        "UPDATE products SET \
            product_class = $3, \
            updated_by = COALESCE($4, updated_by), \
            updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL \
         RETURNING {PRODUCT_COLUMNS}"
    );
    let row = sqlx::query_as::<_, ProductRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .bind(&new_class)
        .bind(updated_by)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(Product::from(row))
}

pub async fn class_lock_status(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<ClassLockStatus, DomainError> {
    // Tenant-scope the existence probe so a leaked id from another tenant
    // resolves to NotFound rather than leaking blocker counts. The blocker
    // tables themselves are still tenant-anchored via the product_id
    // (verified above).
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM products \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if exists.is_none() {
        return Err(DomainError::NotFound("Product not found".to_string()));
    }

    let (movements, lots, tool_instances) = count_class_blockers(conn, id).await?;

    Ok(ClassLockStatus {
        locked: movements + lots + tool_instances > 0,
        movements,
        lots,
        tool_instances,
    })
}
