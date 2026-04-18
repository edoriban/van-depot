use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::inventory_params::{InventoryFilters, InventoryItem};
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::inventory_repo::{self, PgInventoryService};

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::extractors::warehouse_access::ensure_warehouse_access;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InventoryQueryParams {
    pub warehouse_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub low_stock: Option<bool>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Serialize)]
pub struct InventoryItemResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub quantity: f64,
    pub min_stock: f64,
}

impl From<InventoryItem> for InventoryItemResponse {
    fn from(i: InventoryItem) -> Self {
        Self {
            id: i.id,
            product_id: i.product_id,
            product_name: i.product_name,
            product_sku: i.product_sku,
            location_id: i.location_id,
            location_name: i.location_name,
            warehouse_id: i.warehouse_id,
            quantity: i.quantity,
            min_stock: i.min_stock,
        }
    }
}

/// Admin-only opening-balance payload. Used for one-off imports of inventory
/// that already exists on the shelf at go-live — bypasses the receive→Recepción
/// flow so the audit trail doesn't fabricate a fake receipt.
#[derive(Deserialize)]
pub struct OpeningBalanceRequest {
    pub product_id: Uuid,
    pub warehouse_id: Uuid,
    pub location_id: Uuid,
    pub quantity: f64,
    pub lot_number: Option<String>,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub supplier_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Serialize)]
pub struct OpeningBalanceResponse {
    pub product_id: Uuid,
    pub warehouse_id: Uuid,
    pub location_id: Uuid,
    pub quantity: f64,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn inventory_routes() -> Router<AppState> {
    Router::new()
        .route("/inventory", get(list_inventory))
        .route("/inventory/product/{product_id}", get(product_stock))
        .route("/inventory/location/{location_id}", get(location_stock))
        .route("/inventory/opening-balance", post(opening_balance))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn list_inventory(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<InventoryQueryParams>,
) -> Result<Json<PaginatedResponse<InventoryItemResponse>>, ApiError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let filters = InventoryFilters {
        warehouse_id: params.warehouse_id,
        location_id: params.location_id,
        product_id: params.product_id,
        low_stock: params.low_stock,
        search: params.search,
    };

    let svc = PgInventoryService::new(state.pool.clone());
    let (items, total) =
        vandepot_domain::ports::inventory_service::InventoryService::list_inventory(
            &svc,
            filters,
            pagination.limit(),
            pagination.offset(),
        )
        .await?;

    Ok(Json(PaginatedResponse {
        data: items
            .into_iter()
            .map(InventoryItemResponse::from)
            .collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn product_stock(
    State(state): State<AppState>,
    _claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<InventoryItemResponse>>, ApiError> {
    let svc = PgInventoryService::new(state.pool.clone());
    let items =
        vandepot_domain::ports::inventory_service::InventoryService::get_product_stock(
            &svc,
            product_id,
        )
        .await?;

    Ok(Json(
        items.into_iter().map(InventoryItemResponse::from).collect(),
    ))
}

async fn location_stock(
    State(state): State<AppState>,
    claims: Claims,
    Path(location_id): Path<Uuid>,
) -> Result<Json<Vec<InventoryItemResponse>>, ApiError> {
    // Look up warehouse for access check
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT warehouse_id FROM locations WHERE id = $1")
            .bind(location_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let warehouse_id = row
        .map(|r| r.0)
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&claims, &warehouse_id)?;

    let svc = PgInventoryService::new(state.pool.clone());
    let items =
        vandepot_domain::ports::inventory_service::InventoryService::get_location_stock(
            &svc,
            location_id,
        )
        .await?;

    Ok(Json(
        items.into_iter().map(InventoryItemResponse::from).collect(),
    ))
}

async fn opening_balance(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<OpeningBalanceRequest>,
) -> Result<(StatusCode, Json<OpeningBalanceResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;
    ensure_warehouse_access(&claims, &payload.warehouse_id)?;

    inventory_repo::opening_balance(
        &state.pool,
        payload.product_id,
        payload.warehouse_id,
        payload.location_id,
        payload.quantity,
        payload.lot_number.as_deref(),
        payload.batch_date,
        payload.expiration_date,
        payload.supplier_id,
        claims.sub,
        payload.notes.as_deref(),
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(OpeningBalanceResponse {
            product_id: payload.product_id,
            warehouse_id: payload.warehouse_id,
            location_id: payload.location_id,
            quantity: payload.quantity,
        }),
    ))
}
