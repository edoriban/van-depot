use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::recipes_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateRecipeRequest {
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<RecipeItemInput>,
}

#[derive(Deserialize)]
pub struct RecipeItemInput {
    pub product_id: Uuid,
    pub quantity: f64,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateRecipeRequest {
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<RecipeItemInput>,
}

#[derive(Deserialize)]
pub struct AvailabilityQuery {
    pub warehouse_id: Uuid,
}

#[derive(Deserialize)]
pub struct DispatchRequest {
    pub warehouse_id: Uuid,
    pub location_id: Uuid,
}

#[derive(Serialize)]
pub struct RecipeResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Uuid,
    pub is_active: bool,
    pub item_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct RecipeDetailResponse {
    pub recipe: RecipeResponse,
    pub items: Vec<RecipeItemResponse>,
}

#[derive(Serialize)]
pub struct RecipeItemResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub unit_of_measure: String,
    pub quantity: f64,
    pub notes: Option<String>,
}

#[derive(Serialize)]
pub struct AvailabilityResponse {
    pub items: Vec<ItemAvailability>,
    pub all_available: bool,
}

#[derive(Serialize)]
pub struct ItemAvailability {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub required_quantity: f64,
    pub available_quantity: f64,
    pub status: String,
}

#[derive(Serialize)]
pub struct DispatchResponse {
    pub movements_created: i64,
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1/B2/B3/B4 per-route helper convention.
fn require_tenant_for_recipes(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for recipe operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn recipe_routes() -> Router<AppState> {
    Router::new()
        .route("/recipes", get(list_recipes).post(create_recipe))
        .route(
            "/recipes/{id}",
            get(get_recipe).put(update_recipe).delete(delete_recipe),
        )
        .route("/recipes/{id}/availability", get(check_availability))
        .route("/recipes/{id}/dispatch", post(dispatch_recipe))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_recipe(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateRecipeRequest>,
) -> Result<(StatusCode, Json<RecipeDetailResponse>), ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

    let items: Vec<(Uuid, f64, Option<String>)> = payload
        .items
        .into_iter()
        .map(|i| (i.product_id, i.quantity, i.notes))
        .collect();

    let recipe = recipes_repo::create_recipe(
        &mut *tt.tx,
        tenant_id,
        &payload.name,
        payload.description.as_deref(),
        claims.sub,
        &items,
    )
    .await?;

        let recipe_items = recipes_repo::get_recipe_items(&mut *tt.tx, tenant_id, recipe.id).await?;

    let response = RecipeDetailResponse {
        recipe: RecipeResponse {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            created_by: recipe.created_by,
            is_active: recipe.is_active,
            item_count: recipe_items.len() as i64,
            created_at: recipe.created_at,
            updated_at: recipe.updated_at,
        },
        items: recipe_items
            .into_iter()
            .map(|i| RecipeItemResponse {
                id: i.id,
                product_id: i.product_id,
                product_name: i.product_name,
                product_sku: i.product_sku,
                unit_of_measure: i.unit_of_measure,
                quantity: i.quantity,
                notes: i.notes,
            })
            .collect(),
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn list_recipes(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<RecipeResponse>>, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

        let (rows, total) =
        recipes_repo::list_recipes(&mut *tt.tx, tenant_id, params.limit(), params.offset()).await?;

    let data = rows
        .into_iter()
        .map(|r| RecipeResponse {
            id: r.id,
            name: r.name,
            description: r.description,
            created_by: r.created_by,
            is_active: r.is_active,
            item_count: r.item_count,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data,
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_recipe(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<RecipeDetailResponse>, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

        let recipe = recipes_repo::get_recipe(&mut *tt.tx, tenant_id, id).await?;
    let items = recipes_repo::get_recipe_items(&mut *tt.tx, tenant_id, id).await?;

    let response = RecipeDetailResponse {
        recipe: RecipeResponse {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            created_by: recipe.created_by,
            is_active: recipe.is_active,
            item_count: items.len() as i64,
            created_at: recipe.created_at,
            updated_at: recipe.updated_at,
        },
        items: items
            .into_iter()
            .map(|i| RecipeItemResponse {
                id: i.id,
                product_id: i.product_id,
                product_name: i.product_name,
                product_sku: i.product_sku,
                unit_of_measure: i.unit_of_measure,
                quantity: i.quantity,
                notes: i.notes,
            })
            .collect(),
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn update_recipe(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateRecipeRequest>,
) -> Result<Json<RecipeDetailResponse>, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

    let items: Vec<(Uuid, f64, Option<String>)> = payload
        .items
        .into_iter()
        .map(|i| (i.product_id, i.quantity, i.notes))
        .collect();

    let recipe = recipes_repo::update_recipe(
        &mut *tt.tx,
        tenant_id,
        id,
        &payload.name,
        payload.description.as_deref(),
        &items,
    )
    .await?;

        let recipe_items = recipes_repo::get_recipe_items(&mut *tt.tx, tenant_id, recipe.id).await?;

    let response = RecipeDetailResponse {
        recipe: RecipeResponse {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            created_by: recipe.created_by,
            is_active: recipe.is_active,
            item_count: recipe_items.len() as i64,
            created_at: recipe.created_at,
            updated_at: recipe.updated_at,
        },
        items: recipe_items
            .into_iter()
            .map(|i| RecipeItemResponse {
                id: i.id,
                product_id: i.product_id,
                product_name: i.product_name,
                product_sku: i.product_sku,
                unit_of_measure: i.unit_of_measure,
                quantity: i.quantity,
                notes: i.notes,
            })
            .collect(),
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn delete_recipe(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;
    recipes_repo::delete_recipe(&mut *tt.tx, tenant_id, id).await?;
    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn check_availability(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Query(query): Query<AvailabilityQuery>,
) -> Result<Json<AvailabilityResponse>, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

        // Verify recipe exists (tenant-scoped — cross-tenant id resolves to 404).
    let _recipe = recipes_repo::get_recipe(&mut *tt.tx, tenant_id, id).await?;

    let rows =
        recipes_repo::check_availability(&mut *tt.tx, tenant_id, id, query.warehouse_id).await?;

    let all_available = rows.iter().all(|r| r.status == "available");

    let items = rows
        .into_iter()
        .map(|r| ItemAvailability {
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            required_quantity: r.required_quantity,
            available_quantity: r.available_quantity,
            status: r.status,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(AvailabilityResponse {
        items,
        all_available,
    }))
}

async fn dispatch_recipe(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<DispatchRequest>,
) -> Result<Json<DispatchResponse>, ApiError> {
    let tenant_id = require_tenant_for_recipes(&claims)?;

    // Verify recipe exists (tenant-scoped — cross-tenant id resolves to 404).
    {
                let _recipe = recipes_repo::get_recipe(&mut *tt.tx, tenant_id, id).await?;
    }

    let movements_created = recipes_repo::dispatch_recipe(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.warehouse_id,
        payload.location_id,
        claims.sub,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(DispatchResponse { movements_created }))
}
