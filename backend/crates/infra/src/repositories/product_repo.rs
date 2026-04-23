use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{ProductClass, UnitType};
use vandepot_domain::models::product::Product;
use vandepot_domain::ports::product_repository::{ClassLockStatus, ProductRepository};

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct ProductRow {
    id: Uuid,
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

pub struct PgProductRepository {
    pool: PgPool,
}

/// DTO returned by `find_by_id_with_audit` that includes resolved email addresses.
pub struct ProductWithAudit {
    pub product: Product,
    pub updated_by_email: Option<String>,
    pub created_by_email: Option<String>,
}

impl PgProductRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Like `find_by_id` but JOINs users to resolve audit emails.
    pub async fn find_by_id_with_audit(
        &self,
        id: Uuid,
    ) -> Result<Option<ProductWithAudit>, DomainError> {
        let sql = "\
            SELECT p.id, p.name, p.sku, p.description, p.category_id, p.unit_of_measure, \
                   p.product_class, p.has_expiry, p.is_manufactured, \
                   p.min_stock::float8, p.max_stock::float8, p.is_active, \
                   p.created_by, p.updated_by, \
                   p.created_at, p.updated_at, p.deleted_at, \
                   uu.email AS updated_by_email, \
                   uc.email AS created_by_email \
            FROM products p \
            LEFT JOIN users uu ON uu.id = p.updated_by \
            LEFT JOIN users uc ON uc.id = p.created_by \
            WHERE p.id = $1 AND p.deleted_at IS NULL";

        let row = sqlx::query_as::<_, ProductWithAuditRow>(sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(|r| ProductWithAudit {
            updated_by_email: r.updated_by_email.clone(),
            created_by_email: r.created_by_email.clone(),
            product: Product::from(r),
        }))
    }
}

const PRODUCT_COLUMNS: &str = "id, name, sku, description, category_id, unit_of_measure, \
                                product_class, has_expiry, is_manufactured, \
                                min_stock::float8, max_stock::float8, is_active, created_by, updated_by, \
                                created_at, updated_at, deleted_at";

/// Count the three blocker kinds that prevent reclassification of a product:
/// movements, product_lots, and tool_instances. Kept in a single helper so
/// `reclassify` and `class_lock_status` stay in sync.
async fn count_class_blockers_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    product_id: Uuid,
) -> Result<(i64, i64, i64), DomainError> {
    let movements: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;

    let lots: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;

    let tool_instances: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM tool_instances WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;

    Ok((movements.0, lots.0, tool_instances.0))
}

#[async_trait]
impl ProductRepository for PgProductRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Product>, DomainError> {
        let sql = format!(
            "SELECT {} FROM products WHERE id = $1 AND deleted_at IS NULL",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(Product::from))
    }

    async fn list(
        &self,
        search: Option<&str>,
        category_id: Option<Uuid>,
        product_class: Option<ProductClass>,
        is_manufactured: Option<bool>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Product>, i64), DomainError> {
        let search_pattern = search.map(|s| format!("%{}%", s));

        // Build WHERE clauses with sequential param indices starting at $1
        let mut where_clauses = vec!["deleted_at IS NULL".to_string()];
        let mut idx: usize = 0;

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

        // Count query (same params minus LIMIT/OFFSET)
        let count_sql = format!("SELECT COUNT(*) FROM products WHERE {where_sql}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
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
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        // Data query with LIMIT/OFFSET
        idx += 1;
        let limit_idx = idx;
        idx += 1;
        let offset_idx = idx;

        let data_sql = format!(
            "SELECT {PRODUCT_COLUMNS} FROM products WHERE {where_sql} ORDER BY created_at DESC LIMIT ${limit_idx} OFFSET ${offset_idx}"
        );
        let mut data_query = sqlx::query_as::<_, ProductRow>(&data_sql);
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
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn create(
        &self,
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
        // clean typed error; the DB-layer CHECK (migration
        // 20260423000001_add_is_manufactured_to_products.sql) is the backstop.
        if is_manufactured && !matches!(product_class, ProductClass::RawMaterial) {
            // `product_id` is unknown at create time — we pass Uuid::nil() so
            // the API layer still emits the stable error `code`. The spec
            // scenario (§1) asserts only on the code and the absence of a
            // persisted row.
            return Err(DomainError::ProductIsManufacturedRequiresRawMaterial {
                product_id: Uuid::nil(),
            });
        }

        let sql = format!(
            "INSERT INTO products (name, sku, description, category_id, unit_of_measure, \
                                   product_class, has_expiry, is_manufactured, \
                                   min_stock, max_stock, created_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
             RETURNING {}",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
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
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Product::from(row))
    }

    async fn update(
        &self,
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
        // the resulting product MUST have product_class=raw_material. Since
        // update() does NOT accept product_class (reclassify lives on
        // PATCH /products/{id}/class), we resolve the *current* class of the
        // row and reject the combination here. Mirrors design §D3 / spec §1.
        if let Some(true) = is_manufactured {
            let current: Option<(ProductClass,)> = sqlx::query_as(
                "SELECT product_class FROM products WHERE id = $1 AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(&self.pool)
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
                name = COALESCE($2, name), \
                sku = COALESCE($3, sku), \
                description = CASE WHEN $4 THEN $5 ELSE description END, \
                category_id = CASE WHEN $6 THEN $7 ELSE category_id END, \
                unit_of_measure = COALESCE($8, unit_of_measure), \
                has_expiry = COALESCE($9, has_expiry), \
                is_manufactured = COALESCE($10, is_manufactured), \
                min_stock = COALESCE($11, min_stock), \
                max_stock = CASE WHEN $12 THEN $13 ELSE max_stock END, \
                updated_by = COALESCE($14, updated_by), \
                updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING {}",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(id)
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
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Product::from(row))
    }

    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Product not found".to_string()));
        }

        Ok(())
    }

    async fn reclassify(
        &self,
        id: Uuid,
        new_class: ProductClass,
        updated_by: Option<Uuid>,
    ) -> Result<Product, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        // 1. Count blockers. Any nonzero count → refuse to reclassify and
        //    surface the structured `ClassLocked` variant so the API layer
        //    can emit a typed `blocked_by` JSON shape (design §5e).
        let (movements, lots, tool_instances) =
            count_class_blockers_in_tx(&mut tx, id).await?;
        if movements + lots + tool_instances > 0 {
            return Err(DomainError::ClassLocked {
                movements,
                lots,
                tool_instances,
            });
        }

        // 2. Fetch current has_expiry + is_manufactured so we can enforce
        //    (a) the class/expiry invariant and (b) the
        //    is_manufactured→raw_material cross-field invariant without a
        //    second mutating statement. The CHECK constraint on the table is
        //    the ultimate backstop, but surfacing nicer domain errors matches
        //    the `create` path's behavior.
        let current: Option<(bool, bool)> = sqlx::query_as(
            "SELECT has_expiry, is_manufactured \
             FROM products WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        let (has_expiry, is_manufactured) = current
            .ok_or_else(|| DomainError::NotFound("Product not found".to_string()))?;
        if matches!(new_class, ProductClass::ToolSpare) && has_expiry {
            return Err(DomainError::Validation(
                "Cannot reclassify to tool_spare while has_expiry is true".to_string(),
            ));
        }
        // Block moving OUT of `raw_material` while `is_manufactured = true`
        // (design §D3, spec §1). Operator must first clear the flag via
        // PATCH /products/{id} setting is_manufactured=false, then reclassify.
        if is_manufactured && !matches!(new_class, ProductClass::RawMaterial) {
            return Err(DomainError::ProductIsManufacturedRequiresRawMaterial {
                product_id: id,
            });
        }

        // 3. Apply the update and commit.
        let sql = format!(
            "UPDATE products SET \
                product_class = $2, \
                updated_by = COALESCE($3, updated_by), \
                updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING {}",
            PRODUCT_COLUMNS
        );
        let row = sqlx::query_as::<_, ProductRow>(&sql)
            .bind(id)
            .bind(&new_class)
            .bind(updated_by)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(Product::from(row))
    }

    async fn class_lock_status(&self, id: Uuid) -> Result<ClassLockStatus, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        let (movements, lots, tool_instances) =
            count_class_blockers_in_tx(&mut tx, id).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(ClassLockStatus {
            locked: movements + lots + tool_instances > 0,
            movements,
            lots,
            tool_instances,
        })
    }
}
