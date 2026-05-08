use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::category::Category;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::category_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub parent_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct UpdateCategoryRequest {
    pub name: Option<String>,
    pub parent_id: Option<Option<Uuid>>,
}

#[derive(Serialize)]
pub struct CategoryResponse {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Category> for CategoryResponse {
    fn from(c: Category) -> Self {
        Self {
            id: c.id,
            name: c.name,
            parent_id: c.parent_id,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn category_routes() -> Router<AppState> {
    Router::new()
        .route("/categories", post(create_category).get(list_categories))
        .route(
            "/categories/{id}",
            get(get_category)
                .put(update_category)
                .delete(delete_category),
        )
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims. Returns 422 for
/// superadmin tokens that haven't selected a tenant. Mirrors the B1 pattern.
fn require_tenant_for_categories(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for category operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_category(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<CategoryResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_categories(&claims)?;

        // Cross-tenant parent_id surfaces as a 23503 FK violation on
    // categories_parent_tenant_fk (composite). map_sqlx_error converts it
    // to 409 Conflict — see B2 apply-progress for the exact code.
    let category =
        category_repo::create(&mut *tt.tx, tenant_id, &payload.name, payload.parent_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(CategoryResponse::from(category))))
}

async fn list_categories(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<CategoryResponse>>, ApiError> {
    let tenant_id = require_tenant_for_categories(&claims)?;

        let (categories, total) =
        category_repo::list(&mut *tt.tx, tenant_id, params.limit(), params.offset()).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: categories.into_iter().map(CategoryResponse::from).collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_category(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CategoryResponse>, ApiError> {
    let tenant_id = require_tenant_for_categories(&claims)?;

        let category = category_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Category not found".to_string())))?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CategoryResponse::from(category)))
}

async fn update_category(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryRequest>,
) -> Result<Json<CategoryResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_categories(&claims)?;

        let category = category_repo::update(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.name.as_deref(),
        payload.parent_id,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CategoryResponse::from(category)))
}

async fn delete_category(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_categories(&claims)?;

        // Check for children
    if category_repo::has_children(&mut *tt.tx, tenant_id, id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete category with subcategories".to_string(),
        )));
    }

    // Check for products
    if category_repo::has_products(&mut *tt.tx, tenant_id, id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete category with associated products".to_string(),
        )));
    }

    category_repo::delete(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
