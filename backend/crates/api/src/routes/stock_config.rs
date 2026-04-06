use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::stock_config_repo;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
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

// ── Routes ────────────────────────────────────────────────────────────

pub fn stock_config_routes() -> Router<AppState> {
    Router::new()
        .route("/stock-config", get(get_config).put(upsert_config))
        .route("/stock-config/resolve", get(resolve_config))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn get_config(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<StockConfigQuery>,
) -> Result<Json<Option<StockConfigResponse>>, ApiError> {
    let config = if let Some(product_id) = params.product_id {
        stock_config_repo::get_product_config(&state.pool, product_id).await?
    } else if let Some(warehouse_id) = params.warehouse_id {
        stock_config_repo::get_warehouse_config(&state.pool, warehouse_id).await?
    } else {
        stock_config_repo::get_global_config(&state.pool).await?
    };

    Ok(Json(config.map(|row| StockConfigResponse {
        id: row.id,
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        default_min_stock: row.default_min_stock,
        critical_stock_multiplier: row.critical_stock_multiplier,
        low_stock_multiplier: row.low_stock_multiplier,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })))
}

async fn resolve_config(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<ResolveConfigQuery>,
) -> Result<Json<StockConfigResponse>, ApiError> {
    let row =
        stock_config_repo::resolve_config(&state.pool, params.product_id, params.warehouse_id)
            .await?;

    Ok(Json(StockConfigResponse {
        id: row.id,
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        default_min_stock: row.default_min_stock,
        critical_stock_multiplier: row.critical_stock_multiplier,
        low_stock_multiplier: row.low_stock_multiplier,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn upsert_config(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<UpsertStockConfigRequest>,
) -> Result<Json<StockConfigResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

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

    let row = stock_config_repo::upsert_config(
        &state.pool,
        payload.warehouse_id,
        payload.product_id,
        payload.default_min_stock,
        payload.critical_stock_multiplier,
        payload.low_stock_multiplier,
    )
    .await?;

    Ok(Json(StockConfigResponse {
        id: row.id,
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        default_min_stock: row.default_min_stock,
        critical_stock_multiplier: row.critical_stock_multiplier,
        low_stock_multiplier: row.low_stock_multiplier,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}
