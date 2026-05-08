use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::stock_config_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StockConfigQuery {
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct ResolveConfigQuery {
    pub product_id: Uuid,
    pub warehouse_id: Uuid,
}

#[derive(Deserialize)]
pub struct UpsertStockConfigRequest {
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
}

#[derive(Serialize)]
pub struct StockConfigResponse {
    pub id: Uuid,
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct StockConfigOverrideResponse {
    pub id: Uuid,
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn stock_config_routes() -> Router<AppState> {
    Router::new()
        .route("/stock-config", get(get_config).post(create_config))
        .route("/stock-config/global", get(get_global_config))
        .route("/stock-config/overrides", get(list_overrides))
        .route("/stock-config/resolve", get(resolve_config))
        .route(
            "/stock-config/{id}",
            get(get_config_by_id)
                .put(update_config_by_id)
                .delete(delete_config_by_id),
        )
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422 for
/// non-superadmin tokens that haven't selected a tenant. Mirrors the B1..B7
/// per-route helper convention.
fn require_tenant_for_stock_config(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for stock-config operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn get_config(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<StockConfigQuery>,
) -> Result<Json<Option<StockConfigResponse>>, ApiError> {
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    let config = if let Some(product_id) = params.product_id {
        stock_config_repo::get_product_config(&mut *tt.tx, tenant_id, product_id).await?
    } else if let Some(warehouse_id) = params.warehouse_id {
        stock_config_repo::get_warehouse_config(&mut *tt.tx, tenant_id, warehouse_id).await?
    } else {
        stock_config_repo::get_global_config(&mut *tt.tx, tenant_id).await?
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(config.map(row_to_response)))
}

async fn resolve_config(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<ResolveConfigQuery>,
) -> Result<Json<StockConfigResponse>, ApiError> {
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    let row = stock_config_repo::resolve_config(
        &mut *tt.tx,
        tenant_id,
        params.product_id,
        params.warehouse_id,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(row_to_response(row)))
}

async fn get_global_config(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<Option<StockConfigResponse>>, ApiError> {
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    let config = stock_config_repo::get_global_config(&mut *tt.tx, tenant_id).await?;
    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(config.map(row_to_response)))
}

async fn list_overrides(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<StockConfigOverrideResponse>>, ApiError> {
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    let limit = params.limit();
    let offset = params.offset();

    let (rows, total) =
        stock_config_repo::list_overrides(&mut *tt.tx, tenant_id, limit, offset).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: rows.into_iter().map(override_row_to_response).collect(),
        total,
        page: params.page(),
        per_page: limit,
    }))
}

async fn create_config(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<UpsertStockConfigRequest>,
) -> Result<(StatusCode, Json<StockConfigResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    validate_config_payload(&payload)?;

    let row = stock_config_repo::upsert_config(
        &mut *tt.tx,
        tenant_id,
        payload.warehouse_id,
        payload.product_id,
        payload.default_min_stock,
        payload.critical_stock_multiplier,
        payload.low_stock_multiplier,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(row_to_response(row))))
}

async fn get_config_by_id(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<StockConfigResponse>, ApiError> {
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    let row = stock_config_repo::get_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Stock config not found".to_string())))?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(row_to_response(row)))
}

async fn update_config_by_id(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpsertStockConfigRequest>,
) -> Result<Json<StockConfigResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_stock_config(&claims)?;
    validate_config_payload(&payload)?;

    let row = stock_config_repo::update_by_id(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.default_min_stock,
        payload.critical_stock_multiplier,
        payload.low_stock_multiplier,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(row_to_response(row)))
}

async fn delete_config_by_id(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_stock_config(&claims)?;

    stock_config_repo::delete_by_id(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ──────────────────────────────────────────────────────────

fn row_to_response(row: stock_config_repo::StockConfigRow) -> StockConfigResponse {
    StockConfigResponse {
        id: row.id,
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        default_min_stock: row.default_min_stock,
        critical_stock_multiplier: row.critical_stock_multiplier,
        low_stock_multiplier: row.low_stock_multiplier,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn override_row_to_response(
    row: stock_config_repo::StockConfigOverrideRow,
) -> StockConfigOverrideResponse {
    StockConfigOverrideResponse {
        id: row.id,
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        default_min_stock: row.default_min_stock,
        critical_stock_multiplier: row.critical_stock_multiplier,
        low_stock_multiplier: row.low_stock_multiplier,
        created_at: row.created_at,
        updated_at: row.updated_at,
        product_name: row.product_name,
        product_sku: row.product_sku,
    }
}

fn validate_config_payload(payload: &UpsertStockConfigRequest) -> Result<(), ApiError> {
    if payload.default_min_stock < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "default_min_stock must be >= 0".to_string(),
        )));
    }
    if payload.critical_stock_multiplier < 0.0 || payload.critical_stock_multiplier > 1.0 {
        return Err(ApiError(DomainError::Validation(
            "critical_stock_multiplier must be between 0 and 1".to_string(),
        )));
    }
    if payload.low_stock_multiplier < 0.0 || payload.low_stock_multiplier > 1.0 {
        return Err(ApiError(DomainError::Validation(
            "low_stock_multiplier must be between 0 and 1".to_string(),
        )));
    }
    Ok(())
}
