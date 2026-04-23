use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::ProductClass;

use super::shared::map_sqlx_error;

// ── Row structs ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
pub struct RecipeRow {
    pub id: Uuid,
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

// ── Queries ─────────────────────────────────────────────────────────

pub async fn create_recipe(
    pool: &PgPool,
    name: &str,
    description: Option<&str>,
    created_by: Uuid,
    items: &[(Uuid, f64, Option<String>)],
) -> Result<RecipeRow, DomainError> {
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // Guard (design §6e, spec §3): reject recipes whose items reference a
    // `tool_spare` product. Runs BEFORE the header INSERT so a rejected
    // request leaves zero rows in both `recipes` and `recipe_items`. Missing
    // products produce `NotFound` from the same query so the caller sees a
    // clear error instead of a foreign-key surprise down the road.
    for (product_id, _qty, _notes) in items {
        let class: Option<(ProductClass,)> = sqlx::query_as(
            "SELECT product_class FROM products WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(product_id)
        .fetch_optional(&mut *tx)
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
        "INSERT INTO recipes (name, description, created_by) \
         VALUES ($1, $2, $3) \
         RETURNING id, name, description, created_by, is_active, \
                   created_at, updated_at, deleted_at",
    )
    .bind(name)
    .bind(description)
    .bind(created_by)
    .fetch_one(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    for (product_id, quantity, notes) in items {
        sqlx::query(
            "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(recipe.id)
        .bind(product_id)
        .bind(*quantity)
        .bind(notes.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(recipe)
}

pub async fn list_recipes(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<(Vec<RecipeListRow>, i64), DomainError> {
    let rows = sqlx::query_as::<_, RecipeListRow>(
        "SELECT r.id, r.name, r.description, r.created_by, r.is_active, \
                (SELECT COUNT(*) FROM recipe_items WHERE recipe_id = r.id) as item_count, \
                r.created_at, r.updated_at, r.deleted_at \
         FROM recipes r \
         WHERE r.deleted_at IS NULL \
         ORDER BY r.created_at DESC \
         LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    let count = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM recipes WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok((rows, count.count))
}

pub async fn get_recipe(pool: &PgPool, id: Uuid) -> Result<RecipeRow, DomainError> {
    sqlx::query_as::<_, RecipeRow>(
        "SELECT id, name, description, created_by, is_active, \
                created_at, updated_at, deleted_at \
         FROM recipes \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Recipe not found".to_string()))
}

pub async fn get_recipe_items(
    pool: &PgPool,
    recipe_id: Uuid,
) -> Result<Vec<RecipeItemRow>, DomainError> {
    sqlx::query_as::<_, RecipeItemRow>(
        "SELECT ri.id, ri.recipe_id, ri.product_id, \
                p.name as product_name, p.sku as product_sku, \
                p.unit_of_measure::text, ri.quantity::float8, ri.notes \
         FROM recipe_items ri \
         JOIN products p ON ri.product_id = p.id \
         WHERE ri.recipe_id = $1 \
         ORDER BY p.name",
    )
    .bind(recipe_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)
}

pub async fn update_recipe(
    pool: &PgPool,
    id: Uuid,
    name: &str,
    description: Option<&str>,
    items: &[(Uuid, f64, Option<String>)],
) -> Result<RecipeRow, DomainError> {
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // Mirror the create_recipe guard: items must not reference tool_spare
    // products (design §D11).
    for (product_id, _qty, _notes) in items {
        let class: Option<(ProductClass,)> = sqlx::query_as(
            "SELECT product_class FROM products WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(product_id)
        .fetch_optional(&mut *tx)
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
        "UPDATE recipes SET name = $2, description = $3, updated_at = NOW() \
         WHERE id = $1 AND deleted_at IS NULL \
         RETURNING id, name, description, created_by, is_active, \
                   created_at, updated_at, deleted_at",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_error)?
    .ok_or_else(|| DomainError::NotFound("Recipe not found".to_string()))?;

    // Delete existing items and re-insert
    sqlx::query("DELETE FROM recipe_items WHERE recipe_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

    for (product_id, quantity, notes) in items {
        sqlx::query(
            "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(product_id)
        .bind(*quantity)
        .bind(notes.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    }

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(recipe)
}

pub async fn delete_recipe(pool: &PgPool, id: Uuid) -> Result<(), DomainError> {
    let result = sqlx::query(
        "UPDATE recipes SET deleted_at = NOW() \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(map_sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound("Recipe not found".to_string()));
    }

    Ok(())
}

pub async fn check_availability(
    pool: &PgPool,
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
        JOIN products p ON ri.product_id = p.id
        LEFT JOIN inventory i ON i.product_id = ri.product_id
        LEFT JOIN locations l ON i.location_id = l.id AND l.warehouse_id = $2
        WHERE ri.recipe_id = $1
        GROUP BY ri.product_id, p.name, p.sku, ri.quantity
        ORDER BY p.name
        "#,
    )
    .bind(recipe_id)
    .bind(warehouse_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)
}

pub async fn dispatch_recipe(
    pool: &PgPool,
    recipe_id: Uuid,
    warehouse_id: Uuid,
    location_id: Uuid,
    user_id: Uuid,
) -> Result<i64, DomainError> {
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;

    // Fetch recipe items
    let items = sqlx::query_as::<_, RecipeItemRow>(
        "SELECT ri.id, ri.recipe_id, ri.product_id, \
                p.name as product_name, p.sku as product_sku, \
                p.unit_of_measure::text, ri.quantity::float8, ri.notes \
         FROM recipe_items ri \
         JOIN products p ON ri.product_id = p.id \
         WHERE ri.recipe_id = $1 \
         ORDER BY p.name",
    )
    .bind(recipe_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    if items.is_empty() {
        return Err(DomainError::NotFound("Recipe has no items".to_string()));
    }

    // Verify location belongs to warehouse
    let loc_check: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM locations WHERE id = $1 AND warehouse_id = $2",
    )
    .bind(location_id)
    .bind(warehouse_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_error)?;

    if loc_check.is_none() {
        return Err(DomainError::Validation(
            "Location does not belong to the specified warehouse".to_string(),
        ));
    }

    let mut movements_created: i64 = 0;

    for item in &items {
        // Lock and check stock
        let current: (f64,) = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
        )
        .bind(item.product_id)
        .bind(location_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        .unwrap_or((0.0,));

        if current.0 < item.quantity {
            return Err(DomainError::Validation(format!(
                "Insufficient stock for product '{}' (SKU: {}): available {}, required {}",
                item.product_name, item.product_sku, current.0, item.quantity
            )));
        }

        // Decrement inventory
        sqlx::query(
            "UPDATE inventory SET quantity = quantity - $3, updated_at = NOW() \
             WHERE product_id = $1 AND location_id = $2",
        )
        .bind(item.product_id)
        .bind(location_id)
        .bind(item.quantity)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        // Insert exit movement
        let reference = format!("recipe-dispatch:{}", recipe_id);
        sqlx::query(
            "INSERT INTO movements \
                 (product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id) \
             VALUES ($1, $2, NULL, $3, 'exit', $4, $5, $6, NULL)",
        )
        .bind(item.product_id)
        .bind(location_id)
        .bind(item.quantity)
        .bind(user_id)
        .bind(&reference)
        .bind(item.notes.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        movements_created += 1;
    }

    tx.commit().await.map_err(map_sqlx_error)?;
    Ok(movements_created)
}
