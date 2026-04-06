use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::supplier_products_repo;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateSupplierProductRequest {
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: Option<i32>,
    pub minimum_order_qty: Option<f64>,
    pub is_preferred: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateSupplierProductRequest {
    pub supplier_sku: Option<Option<String>>,
    pub unit_cost: Option<f64>,
    pub lead_time_days: Option<i32>,
    pub minimum_order_qty: Option<f64>,
    pub is_preferred: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Serialize)]
pub struct SupplierProductResponse {
    pub id: Uuid,
    pub supplier_id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct SupplierProductWithSupplierResponse {
    pub id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_name: String,
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn supplier_product_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/suppliers/{supplier_id}/products",
            get(list_by_supplier).post(create),
        )
        .route("/products/{product_id}/suppliers", get(list_by_product))
        .route(
            "/supplier-products/{id}",
            put(update).delete(delete),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Path(supplier_id): Path<Uuid>,
    Json(payload): Json<CreateSupplierProductRequest>,
) -> Result<(StatusCode, Json<SupplierProductResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let row = supplier_products_repo::create_supplier_product(
        &state.pool,
        supplier_id,
        payload.product_id,
        payload.supplier_sku.as_deref(),
        payload.unit_cost,
        payload.lead_time_days.unwrap_or(0),
        payload.minimum_order_qty.unwrap_or(1.0),
        payload.is_preferred.unwrap_or(false),
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(SupplierProductResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }),
    ))
}

async fn list_by_supplier(
    State(state): State<AppState>,
    _claims: Claims,
    Path(supplier_id): Path<Uuid>,
) -> Result<Json<Vec<SupplierProductResponse>>, ApiError> {
    let rows = supplier_products_repo::list_by_supplier(&state.pool, supplier_id).await?;

    let data = rows
        .into_iter()
        .map(|row| SupplierProductResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    Ok(Json(data))
}

async fn list_by_product(
    State(state): State<AppState>,
    _claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<SupplierProductWithSupplierResponse>>, ApiError> {
    let rows = supplier_products_repo::list_by_product(&state.pool, product_id).await?;

    let data = rows
        .into_iter()
        .map(|row| SupplierProductWithSupplierResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
            product_id: row.product_id,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    Ok(Json(data))
}

async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateSupplierProductRequest>,
) -> Result<Json<SupplierProductResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let row = supplier_products_repo::update_supplier_product(
        &state.pool,
        id,
        payload.supplier_sku.as_ref().map(|s| s.as_deref()),
        payload.unit_cost,
        payload.lead_time_days,
        payload.minimum_order_qty,
        payload.is_preferred,
        payload.is_active,
    )
    .await?;

    Ok(Json(SupplierProductResponse {
        id: row.id,
        supplier_id: row.supplier_id,
        product_id: row.product_id,
        product_name: row.product_name,
        product_sku: row.product_sku,
        supplier_sku: row.supplier_sku,
        unit_cost: row.unit_cost,
        lead_time_days: row.lead_time_days,
        minimum_order_qty: row.minimum_order_qty,
        is_preferred: row.is_preferred,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    supplier_products_repo::delete_supplier_product(&state.pool, id).await?;

    Ok(StatusCode::NO_CONTENT)
}
