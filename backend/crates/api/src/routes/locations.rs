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
use vandepot_domain::ports::location_repository::LocationRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::location_repo::PgLocationRepository;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
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

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_location(
    State(state): State<AppState>,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Json(payload): Json<CreateLocationRequest>,
) -> Result<(StatusCode, Json<LocationResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let repo = PgLocationRepository::new(state.pool.clone());
    let location = repo
        .create(
            warehouse_id,
            payload.parent_id,
            payload.location_type,
            &payload.name,
            payload.label.as_deref(),
        )
        .await?;

    Ok((StatusCode::CREATED, Json(LocationResponse::from(location))))
}

async fn list_locations(
    State(state): State<AppState>,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Query(params): Query<LocationListParams>,
) -> Result<Json<PaginatedResponse<LocationResponse>>, ApiError> {
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let repo = PgLocationRepository::new(state.pool.clone());
    let fetch_all = params.all.unwrap_or(false);
    let (locations, total) = repo
        .list_by_warehouse(
            warehouse_id,
            if fetch_all { None } else { params.parent_id },
            fetch_all,
            pagination.limit(),
            pagination.offset(),
        )
        .await?;

    Ok(Json(PaginatedResponse {
        data: locations.into_iter().map(LocationResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_location(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<LocationResponse>, ApiError> {
    let repo = PgLocationRepository::new(state.pool.clone());
    let location = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;

    ensure_warehouse_access(&claims, &location.warehouse_id)?;

    Ok(Json(LocationResponse::from(location)))
}

async fn update_location(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateLocationRequest>,
) -> Result<Json<LocationResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgLocationRepository::new(state.pool.clone());

    // Fetch to check warehouse access
    let existing = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;
    ensure_warehouse_access(&claims, &existing.warehouse_id)?;

    let location = repo
        .update(
            id,
            payload.name.as_deref(),
            payload.label.as_ref().map(|l| l.as_deref()),
            payload.location_type,
        )
        .await?;

    Ok(Json(LocationResponse::from(location)))
}

async fn delete_location(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgLocationRepository::new(state.pool.clone());

    // Fetch to check warehouse access
    let existing = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Location not found".to_string())))?;
    ensure_warehouse_access(&claims, &existing.warehouse_id)?;

    // Check for existing inventory
    if repo.has_inventory(id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete location with existing inventory".to_string(),
        )));
    }

    repo.delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
