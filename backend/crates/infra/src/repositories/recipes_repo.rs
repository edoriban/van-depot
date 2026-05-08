//! Recipes (BOM templates) repository — free functions.
//!
//! Phase B batch 5 (multi-tenant-foundation, design §5.4) collapsed the
//! plain free-function shape into the canonical tenant-aware free-function
//! shape established by B1..B4:
//!   * Read functions take `(&mut PgConnection, tenant_id, ...)`.
//!   * Write functions that begin their own tx take `(&PgPool, tenant_id, ...)`.
//!
//! Defense-in-depth: every query carries `WHERE tenant_id = $N`. The
//! composite FKs installed by 20260508000005 reject any cross-tenant
//! INSERT/UPDATE at the DB layer, so the predicate is belt-and-suspenders.
//!
//! Identity correctness: `get_recipe` filters on BOTH `id` and
//! `tenant_id`; cross-tenant probes resolve to `NotFound` rather than
//! leaking existence.
//!
//! `dispatch_recipe` writes to B4 tables (movements, inventory). With B5
//! recipes itself carrying tenant_id, the B4 `fetch_warehouse_tenant_id`
//! shim is gone — tenant_id flows in as the function parameter.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::ProductClass;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct RecipeRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Uuid,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
pub struct RecipeListRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Uuid,
    pub is_active: bool,
    pub item_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
pub struct RecipeItemRow {
    pub id: Uuid,
    pub recipe_id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub unit_of_measure: String,
    pub quantity: f64,
    pub notes: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct RecipeItemAvailabilityRow {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub required_quantity: f64,
    pub available_quantity: f64,
    pub status: String,
}

#[derive(sqlx::FromRow)]
pub struct CountRow {
    pub count: i64,
}

const RECIPE_COLUMNS: &str = "id, tenant_id, name, description, created_by, is_active, \
                              created_at, updated_at, deleted_at";

// ── Queries ─────────────────────────────────────────────────────────

pub async fn create_recipe(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
    description: Option<&str>,
    created_by: Uuid,
    items: &[(Uuid, f64, Option<String>)],
) -> Result<RecipeRow, DomainError> {

    // Guard (design §6e, spec §3): reject recipes whose items reference a
    // `tool_spare` product. Runs BEFORE the header INSERT so a rejected
    // request leaves zero rows in both `recipes` and `recipe_items`. Missing
    // products produce `NotFound` from the same query so the caller sees a
    // clear error instead of a foreign-key surprise down the road.
    //
    // The product probe is tenant-scoped: cross-tenant product_ids resolve
    // to NotFound here, BEFORE the FK violation that would otherwise
    // happen on INSERT. Belt-and-suspenders with the composite FK on
    // recipe_items(tenant_id, product_id) → products(tenant_id, id).
    for (product_id, _qty, _notes) in items {
        let class: Option<(ProductClass,)> = sqlx::query_as(
            "SELECT product_class FROM products \
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
        )
        .bind(product_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        match class {
            None => {
                return Err(DomainError::NotFound(format!(
                    "Product {product_id} not found"
                )));
            }
            Some((ProductClass::ToolSpare,)) => {
                return Err(DomainError::RecipeItemRejectsToolSpare {
                    product_id: *product_id,
                });
            }
            _ => {}
        }
    }

    let recipe = sqlx::query_as::<_, RecipeRow>(
        "INSERT INTO recipes (tenant_id, name, description, created_by) \
         VALUES ($1, $2, $3, $4) \
         RETURNING id, tenant_id, name, description, created_by, is_active, \
                   created_at, updated_at, deleted_at",
    )
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(created_by)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    for (product_id, quantity, notes) in items {
        sqlx::query(
            "INSERT INTO recipe_items (tenant_id, recipe_id, product_id, quantity, notes) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(tenant_id)
        .bind(recipe.id)
        .bind(product_id)
        .bind(*quantity)
        .bind(notes.as_deref())
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    Ok(recipe)
}

pub async fn list_recipes(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<(Vec<RecipeListRow>, i64), DomainError> {
    let rows = sqlx::query_as::<_, RecipeListRow>(
        "SELECT r.id, r.tenant_id, r.name, r.description, r.created_by, r.is_active, \
                (SELECT COUNT(*) FROM recipe_items \
                 WHERE recipe_id = r.id AND tenant_id = r.tenant_id) as item_count, \
                r.created_at, r.updated_at, r.deleted_at \
         FROM recipes r \
         WHERE r.tenant_id = $1 AND r.deleted_at IS NULL \
         ORDER BY r.created_at DESC \
         LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let count = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM recipes \
         WHERE tenant_id = $1 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok((rows, count.count))
}

pub async fn get_recipe(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<RecipeRow, DomainError> {
    let sql = format!(
        "SELECT {RECIPE_COLUMNS} FROM recipes \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL"
    );
    sqlx::query_as::<_, RecipeRow>(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| DomainError::NotFound("Recipe not found".to_string()))
}

pub async fn get_recipe_items(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    recipe_id: Uuid,
) -> Result<Vec<RecipeItemRow>, DomainError> {
    sqlx::query_as::<_, RecipeItemRow>(
        "SELECT ri.id, ri.recipe_id, ri.product_id, \
                p.name as product_name, p.sku as product_sku, \
                p.unit_of_measure::text, ri.quantity::float8, ri.notes \
         FROM recipe_items ri \
         JOIN products p ON ri.product_id = p.id AND p.tenant_id = ri.tenant_id \
         WHERE ri.recipe_id = $1 AND ri.tenant_id = $2 \
         ORDER BY p.name",
    )
    .bind(recipe_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)
}

pub async fn update_recipe(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
    name: &str,
    description: Option<&str>,
    items: &[(Uuid, f64, Option<String>)],
) -> Result<RecipeRow, DomainError> {

    // Mirror the create_recipe guard: items must not reference tool_spare
    // products (design §D11). Tenant-scoped probe.
    for (product_id, _qty, _notes) in items {
        let class: Option<(ProductClass,)> = sqlx::query_as(
            "SELECT product_class FROM products \
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
        )
        .bind(product_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        match class {
            None => {
                return Err(DomainError::NotFound(format!(
                    "Product {product_id} not found"
                )));
            }
            Some((ProductClass::ToolSpare,)) => {
                return Err(DomainError::RecipeItemRejectsToolSpare {
                    product_id: *product_id,
                });
            }
            _ => {}
        }
    }

    let recipe = sqlx::query_as::<_, RecipeRow>(
        "UPDATE recipes SET name = $3, description = $4, updated_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL \
         RETURNING id, tenant_id, name, description, created_by, is_active, \
                   created_at, updated_at, deleted_at",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Recipe not found".to_string()))?;

    // Delete existing items and re-insert (tenant-scoped delete).
    sqlx::query("DELETE FROM recipe_items WHERE recipe_id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

    for (product_id, quantity, notes) in items {
        sqlx::query(
            "INSERT INTO recipe_items (tenant_id, recipe_id, product_id, quantity, notes) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(product_id)
        .bind(*quantity)
        .bind(notes.as_deref())
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;
    }

    Ok(recipe)
}

pub async fn delete_recipe(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "UPDATE recipes SET deleted_at = NOW() \
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Recipe not found".to_string()));
    }

    Ok(())
}

pub async fn check_availability(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    recipe_id: Uuid,
    warehouse_id: Uuid,
) -> Result<Vec<RecipeItemAvailabilityRow>, DomainError> {
    sqlx::query_as::<_, RecipeItemAvailabilityRow>(
        r#"
        SELECT
            ri.product_id,
            p.name as product_name,
            p.sku as product_sku,
            ri.quantity::float8 as required_quantity,
            COALESCE(SUM(i.quantity), 0)::float8 as available_quantity,
            CASE
                WHEN COALESCE(SUM(i.quantity), 0) = 0 THEN 'out_of_stock'
                WHEN COALESCE(SUM(i.quantity), 0) < ri.quantity THEN 'insufficient'
                ELSE 'available'
            END as status
        FROM recipe_items ri
        JOIN products p ON ri.product_id = p.id AND p.tenant_id = ri.tenant_id
        LEFT JOIN inventory i
            ON i.product_id = ri.product_id AND i.tenant_id = ri.tenant_id
        LEFT JOIN locations l
            ON i.location_id = l.id
           AND l.tenant_id = ri.tenant_id
           AND l.warehouse_id = $3
        WHERE ri.recipe_id = $1 AND ri.tenant_id = $2
        GROUP BY ri.product_id, p.name, p.sku, ri.quantity
        ORDER BY p.name
        "#,
    )
    .bind(recipe_id)
    .bind(tenant_id)
    .bind(warehouse_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)
}

pub async fn dispatch_recipe(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    recipe_id: Uuid,
    warehouse_id: Uuid,
    location_id: Uuid,
    user_id: Uuid,
) -> Result<i64, DomainError> {

    // Fetch recipe items (tenant-scoped JOIN).
    let items = sqlx::query_as::<_, RecipeItemRow>(
        "SELECT ri.id, ri.recipe_id, ri.product_id, \
                p.name as product_name, p.sku as product_sku, \
                p.unit_of_measure::text, ri.quantity::float8, ri.notes \
         FROM recipe_items ri \
         JOIN products p ON ri.product_id = p.id AND p.tenant_id = ri.tenant_id \
         WHERE ri.recipe_id = $1 AND ri.tenant_id = $2 \
         ORDER BY p.name",
    )
    .bind(recipe_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if items.is_empty() {
        return Err(DomainError::NotFound("Recipe has no items".to_string()));
    }

    // Verify location belongs to warehouse, AND both are in-tenant.
    let loc_check: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM locations \
         WHERE id = $1 AND warehouse_id = $2 AND tenant_id = $3",
    )
    .bind(location_id)
    .bind(warehouse_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    if loc_check.is_none() {
        return Err(DomainError::Validation(
            "Location does not belong to the specified warehouse".to_string(),
        ));
    }

    let mut movements_created: i64 = 0;

    for item in &items {
        // Lock and check stock — tenant-scoped.
        let current: (f64,) = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3 FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(item.product_id)
        .bind(location_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_sqlx_error)?
        .unwrap_or((0.0,));

        if current.0 < item.quantity {
            return Err(DomainError::Validation(format!(
                "Insufficient stock for product '{}' (SKU: {}): available {}, required {}",
                item.product_name, item.product_sku, current.0, item.quantity
            )));
        }

        // Decrement inventory (tenant-scoped UPDATE).
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $4, updated_at = NOW() \
             WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3",
        )
        .bind(tenant_id)
        .bind(item.product_id)
        .bind(location_id)
        .bind(item.quantity)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        // Insert exit movement (carries tenant_id).
        let reference = format!("recipe-dispatch:{}", recipe_id);
        sqlx::query(
            "INSERT INTO movements \
                 (tenant_id, product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, $3, NULL, $4, 'exit', $5, $6, $7, NULL)",
        )
        .bind(tenant_id)
        .bind(item.product_id)
        .bind(location_id)
        .bind(item.quantity)
        .bind(user_id)
        .bind(&reference)
        .bind(item.notes.as_deref())
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_error)?;

        movements_created += 1;
    }

    Ok(movements_created)
}
