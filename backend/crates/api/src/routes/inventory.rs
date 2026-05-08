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
use vandepot_infra::repositories::inventory_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
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

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the B1/B2/B3
/// per-route helper convention.
fn require_tenant_for_inventory(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for inventory operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
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
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<InventoryQueryParams>,
) -> Result<Json<PaginatedResponse<InventoryItemResponse>>, ApiError> {
    let tenant_id = require_tenant_for_inventory(&claims)?;

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

        let (items, total) = inventory_repo::list_inventory(
        &mut *tt.tx,
        tenant_id,
        filters,
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
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
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<InventoryItemResponse>>, ApiError> {
    let tenant_id = require_tenant_for_inventory(&claims)?;

        let items = inventory_repo::get_product_stock(&mut *tt.tx, tenant_id, product_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(
        items.into_iter().map(InventoryItemResponse::from).collect(),
    ))
}

async fn location_stock(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(location_id): Path<Uuid>,
) -> Result<Json<Vec<InventoryItemResponse>>, ApiError> {
    let tenant_id = require_tenant_for_inventory(&claims)?;

    // Look up warehouse for access check (tenant-scoped).
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT warehouse_id FROM locations \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *tt.tx)
    .await
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let warehouse_id = row
        .map(|r| r.0)
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

        let items = inventory_repo::get_location_stock(&mut *tt.tx, tenant_id, location_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(
        items.into_iter().map(InventoryItemResponse::from).collect(),
    ))
}

async fn opening_balance(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<OpeningBalanceRequest>,
) -> Result<(StatusCode, Json<OpeningBalanceResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_inventory(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &payload.warehouse_id).await?;

    inventory_repo::opening_balance(
        &mut *tt.tx,
        tenant_id,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
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
