use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::category::Category;
use vandepot_domain::ports::category_repository::CategoryRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::category_repo::PgCategoryRepository;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
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

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_category(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<CategoryResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgCategoryRepository::new(state.pool.clone());
    let category = repo.create(&payload.name, payload.parent_id).await?;

    Ok((StatusCode::CREATED, Json(CategoryResponse::from(category))))
}

async fn list_categories(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<CategoryResponse>>, ApiError> {
    let repo = PgCategoryRepository::new(state.pool.clone());
    let (categories, total) = repo.list(params.limit(), params.offset()).await?;

    Ok(Json(PaginatedResponse {
        data: categories.into_iter().map(CategoryResponse::from).collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_category(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CategoryResponse>, ApiError> {
    let repo = PgCategoryRepository::new(state.pool.clone());
    let category = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Category not found".to_string())))?;

    Ok(Json(CategoryResponse::from(category)))
}

async fn update_category(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryRequest>,
) -> Result<Json<CategoryResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgCategoryRepository::new(state.pool.clone());
    let category = repo
        .update(id, payload.name.as_deref(), payload.parent_id)
        .await?;

    Ok(Json(CategoryResponse::from(category)))
}

async fn delete_category(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgCategoryRepository::new(state.pool.clone());

    // Check for children
    if repo.has_children(id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete category with subcategories".to_string(),
        )));
    }

    // Check for products
    if repo.has_products(id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete category with associated products".to_string(),
        )));
    }

    repo.delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
