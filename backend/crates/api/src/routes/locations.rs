use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::LocationType;
use vandepot_domain::models::location::Location;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::location_repo;

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
pub struct CreateLocationRequest {
    pub parent_id: Option<Uuid>,
    pub location_type: LocationType,
    pub name: String,
    pub label: Option<String>,
    /// Clients MUST NOT set this — it's tracked so we can reject forged
    /// payloads that try to impersonate system locations.
    #[serde(default)]
    pub is_system: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateLocationRequest {
    pub name: Option<String>,
    pub label: Option<Option<String>>,
    pub location_type: Option<LocationType>,
}

#[derive(Deserialize)]
pub struct LocationListParams {
    pub parent_id: Option<Uuid>,
    pub all: Option<bool>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Serialize)]
pub struct LocationResponse {
    pub id: Uuid,
    pub warehouse_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub location_type: LocationType,
    pub name: String,
    pub label: Option<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Location> for LocationResponse {
    fn from(l: Location) -> Self {
        Self {
            id: l.id,
            warehouse_id: l.warehouse_id,
            parent_id: l.parent_id,
            location_type: l.location_type,
            name: l.name,
            label: l.label,
            is_active: l.is_active,
            is_system: l.is_system,
            created_at: l.created_at,
            updated_at: l.updated_at,
        }
    }
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn location_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/warehouses/{warehouse_id}/locations",
            post(create_location).get(list_locations),
        )
        .route(
            "/locations/{id}",
            get(get_location)
                .put(update_location)
                .delete(delete_location),
        )
}

// ── Helpers ───────────────────────────────────────────────────────────

fn require_tenant_for_locations(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for location operations (superadmin must select a tenant)".to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_location(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Json(payload): Json<CreateLocationRequest>,
) -> Result<(StatusCode, Json<LocationResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_locations(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    // Reception rows are system-managed — the warehouse-create tx and the
    // backfill migration are the only legitimate sources. Same for is_system.
    if matches!(payload.location_type, LocationType::Reception) || payload.is_system == Some(true) {
        return Err(ApiError(DomainError::Validation(
            "Reception locations are system-managed and cannot be created manually".to_string(),
        )));
    }

        let location = location_repo::create(
        &mut *tt.tx,
        tenant_id,
        warehouse_id,
        payload.parent_id,
        payload.location_type,
        &payload.name,
        payload.label.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(LocationResponse::from(location))))
}

async fn list_locations(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Query(params): Query<LocationListParams>,
) -> Result<Json<PaginatedResponse<LocationResponse>>, ApiError> {
    let tenant_id = require_tenant_for_locations(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let fetch_all = params.all.unwrap_or(false);
        let (locations, total) = location_repo::list_by_warehouse(
        &mut *tt.tx,
        tenant_id,
        warehouse_id,
        if fetch_all { None } else { params.parent_id },
        fetch_all,
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: locations.into_iter().map(LocationResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_location(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<LocationResponse>, ApiError> {
    let tenant_id = require_tenant_for_locations(&claims)?;
        let location = location_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &location.warehouse_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(LocationResponse::from(location)))
}

async fn update_location(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateLocationRequest>,
) -> Result<Json<LocationResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_locations(&claims)?;

    // Fetch to check warehouse access — reuses the same connection slot for
    // both the read and the subsequent UPDATE.
        let existing = location_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &existing.warehouse_id).await?;

        let location = location_repo::update(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.name.as_deref(),
        payload.label.as_ref().map(|l| l.as_deref()),
        payload.location_type,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(LocationResponse::from(location)))
}

async fn delete_location(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_locations(&claims)?;

        let existing = location_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&mut *tt.tx, &claims, &existing.warehouse_id).await?;

        if location_repo::has_inventory(&mut *tt.tx, tenant_id, id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete location with existing inventory".to_string(),
        )));
    }

    location_repo::delete(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
