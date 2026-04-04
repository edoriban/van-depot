use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::UnitType;
use vandepot_domain::models::product::Product;
use vandepot_domain::ports::product_repository::ProductRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::product_repo::PgProductRepository;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateProductRequest {
    pub name: String,
    pub sku: String,
    pub description: Option<String>,
    pub category_id: Option<Uuid>,
    pub unit_of_measure: UnitType,
    pub min_stock: f64,
    pub max_stock: Option<f64>,
}

#[derive(Deserialize)]
pub struct UpdateProductRequest {
    pub name: Option<String>,
    pub sku: Option<String>,
    pub description: Option<Option<String>>,
    pub category_id: Option<Option<Uuid>>,
    pub unit_of_measure: Option<UnitType>,
    pub min_stock: Option<f64>,
    pub max_stock: Option<Option<f64>>,
}

#[derive(Deserialize)]
pub struct ProductListParams {
    pub search: Option<String>,
    pub category_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Serialize)]
pub struct ProductResponse {
    pub id: Uuid,
    pub name: String,
    pub sku: String,
    pub description: Option<String>,
    pub category_id: Option<Uuid>,
    pub unit_of_measure: UnitType,
    pub min_stock: f64,
    pub max_stock: Option<f64>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Product> for ProductResponse {
    fn from(p: Product) -> Self {
        Self {
            id: p.id,
            name: p.name,
            sku: p.sku,
            description: p.description,
            category_id: p.category_id,
            unit_of_measure: p.unit_of_measure,
            min_stock: p.min_stock,
            max_stock: p.max_stock,
            is_active: p.is_active,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn product_routes() -> Router<AppState> {
    Router::new()
        .route("/products", post(create_product).get(list_products))
        .route(
            "/products/{id}",
            get(get_product)
                .put(update_product)
                .delete(delete_product),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_product(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateProductRequest>,
) -> Result<(StatusCode, Json<ProductResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    let product = repo
        .create(
            &payload.name,
            &payload.sku,
            payload.description.as_deref(),
            payload.category_id,
            payload.unit_of_measure,
            payload.min_stock,
            payload.max_stock,
        )
        .await?;

    Ok((StatusCode::CREATED, Json(ProductResponse::from(product))))
}

async fn list_products(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<ProductListParams>,
) -> Result<Json<PaginatedResponse<ProductResponse>>, ApiError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let repo = PgProductRepository::new(state.pool.clone());
    let (products, total) = repo
        .list(
            params.search.as_deref(),
            params.category_id,
            pagination.limit(),
            pagination.offset(),
        )
        .await?;

    Ok(Json(PaginatedResponse {
        data: products.into_iter().map(ProductResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_product(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<ProductResponse>, ApiError> {
    let repo = PgProductRepository::new(state.pool.clone());
    let product = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Product not found".to_string())))?;

    Ok(Json(ProductResponse::from(product)))
}

async fn update_product(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateProductRequest>,
) -> Result<Json<ProductResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    let product = repo
        .update(
            id,
            payload.name.as_deref(),
            payload.sku.as_deref(),
            payload.description.as_ref().map(|d| d.as_deref()),
            payload.category_id,
            payload.unit_of_measure,
            payload.min_stock,
            payload.max_stock,
        )
        .await?;

    Ok(Json(ProductResponse::from(product)))
}

async fn delete_product(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    repo.soft_delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
