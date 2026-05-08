use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::cycle_count::{CycleCount, CycleCountItem, CycleCountStatus};
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::cycle_count_repo::{self, CycleCountSummary};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use crate::extractors::warehouse_access::ensure_warehouse_access;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateCycleCountRequest {
    pub warehouse_id: Uuid,
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct RecordCountRequest {
    pub counted_quantity: f64,
}

#[derive(Deserialize)]
pub struct CycleCountQueryParams {
    pub warehouse_id: Option<Uuid>,
    pub status: Option<CycleCountStatus>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Serialize)]
pub struct CycleCountResponse {
    pub id: Uuid,
    pub warehouse_id: Uuid,
    pub name: String,
    pub status: CycleCountStatus,
    pub created_by: Uuid,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<CycleCount> for CycleCountResponse {
    fn from(cc: CycleCount) -> Self {
        Self {
            id: cc.id,
            warehouse_id: cc.warehouse_id,
            name: cc.name,
            status: cc.status,
            created_by: cc.created_by,
            completed_at: cc.completed_at,
            notes: cc.notes,
            created_at: cc.created_at,
            updated_at: cc.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct CycleCountDetailResponse {
    #[serde(flatten)]
    pub cycle_count: CycleCountResponse,
    pub total_items: i64,
    pub counted_items: i64,
    pub discrepancy_count: i64,
}

#[derive(Serialize)]
pub struct CycleCountItemResponse {
    pub id: Uuid,
    pub cycle_count_id: Uuid,
    pub product_id: Uuid,
    pub location_id: Uuid,
    pub system_quantity: f64,
    pub counted_quantity: Option<f64>,
    pub variance: Option<f64>,
    pub counted_by: Option<Uuid>,
    pub counted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
    pub location_name: Option<String>,
}

impl From<CycleCountItem> for CycleCountItemResponse {
    fn from(item: CycleCountItem) -> Self {
        Self {
            id: item.id,
            cycle_count_id: item.cycle_count_id,
            product_id: item.product_id,
            location_id: item.location_id,
            system_quantity: item.system_quantity,
            counted_quantity: item.counted_quantity,
            variance: item.variance,
            counted_by: item.counted_by,
            counted_at: item.counted_at,
            created_at: item.created_at,
            product_name: item.product_name,
            product_sku: item.product_sku,
            location_name: item.location_name,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns a
/// 422 for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1..B6 per-route helper convention.
fn require_tenant_for_cycle_counts(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for cycle count operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn cycle_count_routes() -> Router<AppState> {
    Router::new()
        .route("/cycle-counts", post(create_cycle_count).get(list_cycle_counts))
        .route("/cycle-counts/{id}", get(get_cycle_count))
        .route("/cycle-counts/{id}/start", put(start_cycle_count))
        .route(
            "/cycle-counts/{id}/items/{item_id}/count",
            post(record_item_count),
        )
        .route(
            "/cycle-counts/{id}/discrepancies",
            get(list_discrepancies),
        )
        .route("/cycle-counts/{id}/apply", post(apply_cycle_count))
        .route("/cycle-counts/{id}/cancel", put(cancel_cycle_count))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_cycle_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateCycleCountRequest>,
) -> Result<(StatusCode, Json<CycleCountResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &payload.warehouse_id).await?;

    if payload.name.trim().is_empty() {
        return Err(ApiError(DomainError::Validation(
            "Name cannot be empty".to_string(),
        )));
    }

    let cc = cycle_count_repo::create(
        &mut *tt.tx,
        tenant_id,
        payload.warehouse_id,
        payload.name.trim(),
        payload.notes.as_deref(),
        claims.sub,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(CycleCountResponse::from(cc))))
}

async fn list_cycle_counts(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<CycleCountQueryParams>,
) -> Result<Json<PaginatedResponse<CycleCountResponse>>, ApiError> {
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

        let (counts, total) = cycle_count_repo::list(
        &mut *tt.tx,
        tenant_id,
        params.warehouse_id,
        params.status,
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: counts.into_iter().map(CycleCountResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_cycle_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CycleCountDetailResponse>, ApiError> {
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

        let cc = cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;
    let summary: CycleCountSummary =
        cycle_count_repo::get_summary(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CycleCountDetailResponse {
        cycle_count: CycleCountResponse::from(cc),
        total_items: summary.total_items,
        counted_items: summary.counted_items,
        discrepancy_count: summary.discrepancy_count,
    }))
}

async fn start_cycle_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CycleCountResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

        let cc = cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &cc.warehouse_id).await?;

    if cc.status != CycleCountStatus::Draft {
        return Err(ApiError(DomainError::Validation(
            "Only draft cycle counts can be started".to_string(),
        )));
    }

    let updated = cycle_count_repo::update_status(
        &mut *tt.tx,
        tenant_id,
        id,
        CycleCountStatus::InProgress,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CycleCountResponse::from(updated)))
}

async fn record_item_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path((id, item_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<RecordCountRequest>,
) -> Result<Json<CycleCountItemResponse>, ApiError> {
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

    if payload.counted_quantity < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Counted quantity must be >= 0".to_string(),
        )));
    }

        let cc = cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &cc.warehouse_id).await?;

    if cc.status != CycleCountStatus::InProgress {
        return Err(ApiError(DomainError::Validation(
            "Cycle count must be in_progress to record counts".to_string(),
        )));
    }

    // Verify item belongs to this cycle count.
    let item = cycle_count_repo::find_item_by_id(&mut *tt.tx, tenant_id, item_id)
        .await?
        .ok_or_else(|| {
            ApiError(DomainError::NotFound(
                "Cycle count item not found".to_string(),
            ))
        })?;

    if item.cycle_count_id != id {
        return Err(ApiError(DomainError::Validation(
            "Item does not belong to this cycle count".to_string(),
        )));
    }

    let updated = cycle_count_repo::record_count(
        &mut *tt.tx,
        tenant_id,
        item_id,
        payload.counted_quantity,
        claims.sub,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CycleCountItemResponse::from(updated)))
}

async fn list_discrepancies(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<CycleCountItemResponse>>, ApiError> {
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

        // Verify cycle count exists (tenant-scoped).
    cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;

    let items = cycle_count_repo::list_discrepancies(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(
        items.into_iter().map(CycleCountItemResponse::from).collect(),
    ))
}

async fn apply_cycle_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CycleCountResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

        let cc = cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &cc.warehouse_id).await?;

    if cc.status != CycleCountStatus::InProgress {
        return Err(ApiError(DomainError::Validation(
            "Only in_progress cycle counts can be applied".to_string(),
        )));
    }

    let updated =
        cycle_count_repo::apply_adjustments(&mut *tt.tx, tenant_id, id, claims.sub).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CycleCountResponse::from(updated)))
}

async fn cancel_cycle_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<CycleCountResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_cycle_counts(&claims)?;

        let cc = cycle_count_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Cycle count not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &cc.warehouse_id).await?;

    if cc.status == CycleCountStatus::Completed {
        return Err(ApiError(DomainError::Validation(
            "Completed cycle counts cannot be cancelled".to_string(),
        )));
    }

    let updated = cycle_count_repo::update_status(
        &mut *tt.tx,
        tenant_id,
        id,
        CycleCountStatus::Cancelled,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(CycleCountResponse::from(updated)))
}
