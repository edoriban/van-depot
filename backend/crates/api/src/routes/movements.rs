use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::MovementType;
use vandepot_domain::models::inventory_params::{
    AdjustmentParams, EntryParams, ExitParams, MovementFilters, TransferParams,
};
use vandepot_domain::models::movement::Movement;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::inventory_repo::PgInventoryService;

use crate::error::ApiError;
use crate::extractors::warehouse_access::ensure_warehouse_access;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EntryRequest {
    pub product_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub supplier_id: Option<Uuid>,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct ExitRequest {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
    pub quantity: f64,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct TransferRequest {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct AdjustmentRequest {
    pub product_id: Uuid,
    pub location_id: Uuid,
    pub new_quantity: f64,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct MovementQueryParams {
    pub product_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub movement_type: Option<MovementType>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Serialize)]
pub struct MovementResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub from_location_id: Option<Uuid>,
    pub to_location_id: Option<Uuid>,
    pub quantity: f64,
    pub movement_type: MovementType,
    pub user_id: Uuid,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub movement_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<Movement> for MovementResponse {
    fn from(m: Movement) -> Self {
        Self {
            id: m.id,
            product_id: m.product_id,
            from_location_id: m.from_location_id,
            to_location_id: m.to_location_id,
            quantity: m.quantity,
            movement_type: m.movement_type,
            user_id: m.user_id,
            reference: m.reference,
            notes: m.notes,
            supplier_id: m.supplier_id,
            movement_reason: m.movement_reason,
            created_at: m.created_at,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Look up the warehouse that owns a location, returning an error if not found.
async fn get_location_warehouse_id(
    pool: &sqlx::PgPool,
    location_id: Uuid,
) -> Result<Uuid, ApiError> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT warehouse_id FROM locations WHERE id = $1")
            .bind(location_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    row.map(|r| r.0)
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn movement_routes() -> Router<AppState> {
    Router::new()
        .route("/movements/entry", post(record_entry))
        .route("/movements/exit", post(record_exit))
        .route("/movements/transfer", post(record_transfer))
        .route("/movements/adjustment", post(record_adjustment))
        .route("/movements", get(list_movements))
        .route("/movements/{id}", get(get_movement))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn record_entry(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<EntryRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        )));
    }

    let warehouse_id = get_location_warehouse_id(&state.pool, payload.to_location_id).await?;
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let svc = PgInventoryService::new(state.pool.clone());
    let movement = vandepot_domain::ports::inventory_service::InventoryService::record_entry(
        &svc,
        EntryParams {
            product_id: payload.product_id,
            to_location_id: payload.to_location_id,
            quantity: payload.quantity,
            user_id: claims.sub,
            supplier_id: payload.supplier_id,
            reference: payload.reference,
            notes: payload.notes,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_exit(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<ExitRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        )));
    }

    let warehouse_id = get_location_warehouse_id(&state.pool, payload.from_location_id).await?;
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let svc = PgInventoryService::new(state.pool.clone());
    let movement = vandepot_domain::ports::inventory_service::InventoryService::record_exit(
        &svc,
        ExitParams {
            product_id: payload.product_id,
            from_location_id: payload.from_location_id,
            quantity: payload.quantity,
            user_id: claims.sub,
            reference: payload.reference,
            notes: payload.notes,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_transfer(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<TransferRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        )));
    }

    if payload.from_location_id == payload.to_location_id {
        return Err(ApiError(DomainError::Validation(
            "Source and destination locations must be different".to_string(),
        )));
    }

    let from_warehouse_id =
        get_location_warehouse_id(&state.pool, payload.from_location_id).await?;
    ensure_warehouse_access(&claims, &from_warehouse_id)?;

    let to_warehouse_id = get_location_warehouse_id(&state.pool, payload.to_location_id).await?;
    ensure_warehouse_access(&claims, &to_warehouse_id)?;

    let svc = PgInventoryService::new(state.pool.clone());
    let movement = vandepot_domain::ports::inventory_service::InventoryService::record_transfer(
        &svc,
        TransferParams {
            product_id: payload.product_id,
            from_location_id: payload.from_location_id,
            to_location_id: payload.to_location_id,
            quantity: payload.quantity,
            user_id: claims.sub,
            reference: payload.reference,
            notes: payload.notes,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_adjustment(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<AdjustmentRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.new_quantity < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "New quantity must be >= 0".to_string(),
        )));
    }

    let warehouse_id = get_location_warehouse_id(&state.pool, payload.location_id).await?;
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let svc = PgInventoryService::new(state.pool.clone());
    let movement = vandepot_domain::ports::inventory_service::InventoryService::record_adjustment(
        &svc,
        AdjustmentParams {
            product_id: payload.product_id,
            location_id: payload.location_id,
            new_quantity: payload.new_quantity,
            user_id: claims.sub,
            reference: payload.reference,
            notes: payload.notes,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn list_movements(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<MovementQueryParams>,
) -> Result<Json<PaginatedResponse<MovementResponse>>, ApiError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let filters = MovementFilters {
        product_id: params.product_id,
        location_id: params.location_id,
        movement_type: params.movement_type,
        start_date: params.start_date,
        end_date: params.end_date,
    };

    let svc = PgInventoryService::new(state.pool.clone());
    let (movements, total) =
        vandepot_domain::ports::inventory_service::InventoryService::list_movements(
            &svc,
            filters,
            pagination.limit(),
            pagination.offset(),
        )
        .await?;

    Ok(Json(PaginatedResponse {
        data: movements.into_iter().map(MovementResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_movement(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<MovementResponse>, ApiError> {
    let svc = PgInventoryService::new(state.pool.clone());
    let movement = vandepot_domain::ports::inventory_service::InventoryService::find_movement_by_id(
        &svc, id,
    )
    .await?
    .ok_or_else(|| ApiError(DomainError::NotFound("Movement not found".to_string())))?;

    Ok(Json(MovementResponse::from(movement)))
}
