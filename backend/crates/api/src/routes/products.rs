use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{ProductClass, UnitType};
use vandepot_domain::models::product::Product;
use vandepot_domain::ports::product_repository::{ClassLockStatus, ProductRepository};
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
    pub product_class: ProductClass,
    #[serde(default)]
    pub has_expiry: bool,
    /// Marks the product as an internally-manufactured finished good. Only
    /// valid when `product_class = raw_material` (enforced in the repo).
    /// Defaults to `false` when omitted (work-orders-and-bom design §D3).
    #[serde(default)]
    pub is_manufactured: Option<bool>,
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
    /// `product_class` is intentionally NOT accepted here — class changes
    /// flow through `PATCH /products/{id}/class`.
    pub has_expiry: Option<bool>,
    /// Patch the `is_manufactured` flag. Omit to leave unchanged.
    pub is_manufactured: Option<bool>,
    pub min_stock: Option<f64>,
    pub max_stock: Option<Option<f64>>,
}

#[derive(Deserialize)]
pub struct ProductListParams {
    pub search: Option<String>,
    pub category_id: Option<Uuid>,
    /// Filter by product class. Bound to the `?class=` query-string key.
    #[serde(rename = "class")]
    pub product_class: Option<ProductClass>,
    /// Filter manufacturable SKUs only (used by the WO creation dialog to
    /// populate the FG selector). work-orders-and-bom design §7c.
    pub is_manufactured: Option<bool>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Deserialize)]
pub struct ReclassifyProductRequest {
    pub product_class: ProductClass,
}

#[derive(Serialize)]
pub struct ClassLockResponse {
    pub locked: bool,
    pub movements: i64,
    pub lots: i64,
    pub tool_instances: i64,
}

impl From<ClassLockStatus> for ClassLockResponse {
    fn from(s: ClassLockStatus) -> Self {
        Self {
            locked: s.locked,
            movements: s.movements,
            lots: s.lots,
            tool_instances: s.tool_instances,
        }
    }
}

#[derive(Serialize)]
pub struct ProductResponse {
    pub id: Uuid,
    pub name: String,
    pub sku: String,
    pub description: Option<String>,
    pub category_id: Option<Uuid>,
    pub unit_of_measure: UnitType,
    pub product_class: ProductClass,
    pub has_expiry: bool,
    /// Whether this product is produced internally (can be the FG of a
    /// work order). See work-orders-and-bom design §D3.
    pub is_manufactured: bool,
    pub min_stock: f64,
    pub max_stock: Option<f64>,
    pub is_active: bool,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub updated_by_email: Option<String>,
    pub created_by_email: Option<String>,
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
            product_class: p.product_class,
            has_expiry: p.has_expiry,
            is_manufactured: p.is_manufactured,
            min_stock: p.min_stock,
            max_stock: p.max_stock,
            is_active: p.is_active,
            created_by: p.created_by,
            updated_by: p.updated_by,
            updated_by_email: None,
            created_by_email: None,
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
        .route("/products/{id}/class", patch(reclassify_product))
        .route("/products/{id}/class-lock", get(get_class_lock))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_product(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateProductRequest>,
) -> Result<(StatusCode, Json<ProductResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    // Batch 3 (work-orders-and-bom): thread `is_manufactured` from the DTO.
    // Defaults to `false` when absent, matching the DB default and Batch 2
    // behavior. The cross-field invariant (manufactured => raw_material) is
    // enforced in the repo (product_repo::create) and surfaces as 422
    // `PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL`.
    let product = repo
        .create(
            &payload.name,
            &payload.sku,
            payload.description.as_deref(),
            payload.category_id,
            payload.unit_of_measure,
            payload.product_class,
            payload.has_expiry,
            payload.is_manufactured.unwrap_or(false),
            payload.min_stock,
            payload.max_stock,
            Some(claims.sub),
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
            params.product_class,
            params.is_manufactured,
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
    let result = repo
        .find_by_id_with_audit(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Product not found".to_string())))?;

    let mut resp = ProductResponse::from(result.product);
    resp.updated_by_email = result.updated_by_email;
    resp.created_by_email = result.created_by_email;
    Ok(Json(resp))
}

async fn update_product(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateProductRequest>,
) -> Result<Json<ProductResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    // Batch 3 (work-orders-and-bom): thread `is_manufactured` from the DTO.
    // `None` leaves the existing value untouched (COALESCE in SQL); `Some`
    // applies the patch. The cross-field invariant is re-checked in the repo.
    let product = repo
        .update(
            id,
            payload.name.as_deref(),
            payload.sku.as_deref(),
            payload.description.as_ref().map(|d| d.as_deref()),
            payload.category_id,
            payload.unit_of_measure,
            payload.has_expiry,
            payload.is_manufactured,
            payload.min_stock,
            payload.max_stock,
            Some(claims.sub),
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

async fn reclassify_product(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<ReclassifyProductRequest>,
) -> Result<Json<ProductResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgProductRepository::new(state.pool.clone());
    let product = repo
        .reclassify(id, payload.product_class, Some(claims.sub))
        .await?;

    Ok(Json(ProductResponse::from(product)))
}

async fn get_class_lock(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<ClassLockResponse>, ApiError> {
    let repo = PgProductRepository::new(state.pool.clone());
    let status = repo.class_lock_status(id).await?;
    Ok(Json(ClassLockResponse::from(status)))
}
