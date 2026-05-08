use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{LocationType, MovementType};
use vandepot_domain::models::inventory_params::{
    AdjustmentParams, EntryParams, ExitParams, MovementFilters, TransferParams,
};
use vandepot_domain::models::movement::Movement;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::inventory_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
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
    /// Filter movements tied to a specific work order. Used by the WO
    /// detail page to show the wo_issue / back_flush / production_output /
    /// wo_cancel_reversal movement chain (work-orders-and-bom design §7b).
    pub work_order_id: Option<Uuid>,
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

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the B1/B2/B3
/// per-route helper convention.
fn require_tenant_for_movements(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for movement operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

/// Fetch `(warehouse_id, location_type)` for a location WITHIN the caller's
/// tenant, erroring with 404 when missing. Cross-tenant location_ids
/// resolve to NotFound here — they cannot be probed for type information.
async fn get_location_meta(
    conn: &mut sqlx::PgConnection,
    tenant_id: Uuid,
    location_id: Uuid,
) -> Result<(Uuid, LocationType), ApiError> {
    let row: Option<(Uuid, LocationType)> = sqlx::query_as(
        "SELECT warehouse_id, location_type FROM locations \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(location_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    row.ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))
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
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<EntryRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        )));
    }

    let tenant_id = require_tenant_for_movements(&claims)?;

    let (warehouse_id, loc_type) =
        get_location_meta(&mut *tt.tx, tenant_id, payload.to_location_id).await?;
    if matches!(loc_type, LocationType::Reception) {
        return Err(ApiError(DomainError::Validation(
            "Entries cannot target a Reception location — use POST /lots/receive"
                .to_string(),
        )));
    }
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let movement = inventory_repo::record_entry(
        &mut *tt.tx,
        tenant_id,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_exit(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<ExitRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity must be greater than 0".to_string(),
        )));
    }

    let tenant_id = require_tenant_for_movements(&claims)?;

    let (warehouse_id, loc_type) =
        get_location_meta(&mut *tt.tx, tenant_id, payload.from_location_id).await?;
    if matches!(loc_type, LocationType::Reception) {
        return Err(ApiError(DomainError::Validation(
            "Exits cannot come from a Reception location — \
             use POST /lots/{id}/distribute to move out of Reception"
                .to_string(),
        )));
    }
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let movement = inventory_repo::record_exit(
        &mut *tt.tx,
        tenant_id,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_transfer(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
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

    let tenant_id = require_tenant_for_movements(&claims)?;

    let (from_warehouse_id, from_type) =
        get_location_meta(&mut *tt.tx, tenant_id, payload.from_location_id).await?;
    let (to_warehouse_id, to_type) =
        get_location_meta(&mut *tt.tx, tenant_id, payload.to_location_id).await?;
    if matches!(from_type, LocationType::Reception)
        || matches!(to_type, LocationType::Reception)
    {
        return Err(ApiError(DomainError::Validation(
            "Transfers cannot involve a Reception location — \
             use POST /lots/{id}/distribute or /lots/receive instead"
                .to_string(),
        )));
    }
    ensure_warehouse_access(&mut *tt.tx, &claims, &from_warehouse_id).await?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &to_warehouse_id).await?;

    let movement = inventory_repo::record_transfer(
        &mut *tt.tx,
        tenant_id,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn record_adjustment(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<AdjustmentRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), ApiError> {
    if payload.new_quantity < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "New quantity must be >= 0".to_string(),
        )));
    }

    let tenant_id = require_tenant_for_movements(&claims)?;

    let (warehouse_id, loc_type) =
        get_location_meta(&mut *tt.tx, tenant_id, payload.location_id).await?;
    if matches!(loc_type, LocationType::Reception) {
        return Err(ApiError(DomainError::Validation(
            "Adjustments cannot target a Reception location".to_string(),
        )));
    }
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let movement = inventory_repo::record_adjustment(
        &mut *tt.tx,
        tenant_id,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(movement))))
}

async fn list_movements(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<MovementQueryParams>,
) -> Result<Json<PaginatedResponse<MovementResponse>>, ApiError> {
    let tenant_id = require_tenant_for_movements(&claims)?;

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
        work_order_id: params.work_order_id,
    };

        let (movements, total) = inventory_repo::list_movements(
        &mut *tt.tx,
        tenant_id,
        filters,
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: movements.into_iter().map(MovementResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_movement(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<MovementResponse>, ApiError> {
    let tenant_id = require_tenant_for_movements(&claims)?;

        let movement = inventory_repo::find_movement_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Movement not found".to_string())))?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(MovementResponse::from(movement)))
}
