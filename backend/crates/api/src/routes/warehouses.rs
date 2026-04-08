use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::models::warehouse::Warehouse;
use vandepot_domain::ports::warehouse_repository::WarehouseRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::warehouse_repo::{PgWarehouseRepository, WarehouseWithStatsRow};

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::extractors::warehouse_access::ensure_warehouse_access;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWarehouseRequest {
    pub name: String,
    pub address: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateWarehouseRequest {
    pub name: Option<String>,
    pub address: Option<Option<String>>,
}

#[derive(Serialize)]
pub struct WarehouseResponse {
    pub id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct WarehouseWithStatsResponse {
    pub id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub is_active: bool,
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub locations_count: i64,
    pub products_count: i64,
    pub total_quantity: f64,
    pub low_stock_count: i64,
    pub critical_count: i64,
    pub last_movement_at: Option<DateTime<Utc>>,
}

impl From<WarehouseWithStatsRow> for WarehouseWithStatsResponse {
    fn from(r: WarehouseWithStatsRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            address: r.address,
            is_active: r.is_active,
            canvas_width: r.canvas_width,
            canvas_height: r.canvas_height,
            created_at: r.created_at,
            updated_at: r.updated_at,
            locations_count: r.locations_count,
            products_count: r.products_count,
            total_quantity: r.total_quantity,
            low_stock_count: r.low_stock_count,
            critical_count: r.critical_count,
            last_movement_at: r.last_movement_at,
        }
    }
}

impl From<Warehouse> for WarehouseResponse {
    fn from(w: Warehouse) -> Self {
        Self {
            id: w.id,
            name: w.name,
            address: w.address,
            is_active: w.is_active,
            created_at: w.created_at,
            updated_at: w.updated_at,
        }
    }
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn warehouse_routes() -> Router<AppState> {
    Router::new()
        .route("/warehouses", post(create_warehouse).get(list_warehouses))
        .route("/warehouses/with-stats", get(list_warehouses_with_stats))
        .route(
            "/warehouses/{id}",
            get(get_warehouse)
                .put(update_warehouse)
                .delete(delete_warehouse),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateWarehouseRequest>,
) -> Result<(StatusCode, Json<WarehouseResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgWarehouseRepository::new(state.pool.clone());
    let warehouse = repo
        .create(&payload.name, payload.address.as_deref())
        .await?;

    Ok((StatusCode::CREATED, Json(WarehouseResponse::from(warehouse))))
}

async fn list_warehouses(
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<WarehouseResponse>>, ApiError> {
    let repo = PgWarehouseRepository::new(state.pool.clone());
    let (warehouses, total) = repo.list(params.limit(), params.offset()).await?;

    // Non-superadmin users only see warehouses they have access to
    let filtered: Vec<WarehouseResponse> = if claims.role.eq_ignore_ascii_case("superadmin") {
        warehouses.into_iter().map(WarehouseResponse::from).collect()
    } else {
        warehouses
            .into_iter()
            .filter(|w| claims.warehouse_ids.contains(&w.id))
            .map(WarehouseResponse::from)
            .collect()
    };

    let filtered_total = if claims.role.eq_ignore_ascii_case("superadmin") {
        total
    } else {
        filtered.len() as i64
    };

    Ok(Json(PaginatedResponse {
        data: filtered,
        total: filtered_total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn list_warehouses_with_stats(
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<WarehouseWithStatsResponse>>, ApiError> {
    let repo = PgWarehouseRepository::new(state.pool.clone());
    let (rows, total) = repo.list_with_stats(params.limit(), params.offset()).await?;

    let filtered: Vec<WarehouseWithStatsResponse> =
        if claims.role.eq_ignore_ascii_case("superadmin") {
            rows.into_iter()
                .map(WarehouseWithStatsResponse::from)
                .collect()
        } else {
            rows.into_iter()
                .filter(|r| claims.warehouse_ids.contains(&r.id))
                .map(WarehouseWithStatsResponse::from)
                .collect()
        };

    let filtered_total = if claims.role.eq_ignore_ascii_case("superadmin") {
        total
    } else {
        filtered.len() as i64
    };

    Ok(Json(PaginatedResponse {
        data: filtered,
        total: filtered_total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<WarehouseResponse>, ApiError> {
    ensure_warehouse_access(&claims, &id)?;

    let repo = PgWarehouseRepository::new(state.pool.clone());
    let warehouse = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| {
            ApiError(vandepot_domain::error::DomainError::NotFound(
                "Warehouse not found".to_string(),
            ))
        })?;

    Ok(Json(WarehouseResponse::from(warehouse)))
}

async fn update_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateWarehouseRequest>,
) -> Result<Json<WarehouseResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;
    ensure_warehouse_access(&claims, &id)?;

    let repo = PgWarehouseRepository::new(state.pool.clone());
    let warehouse = repo
        .update(
            id,
            payload.name.as_deref(),
            payload.address.as_ref().map(|a| a.as_deref()),
        )
        .await?;

    Ok(Json(WarehouseResponse::from(warehouse)))
}

async fn delete_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin"])?;

    let repo = PgWarehouseRepository::new(state.pool.clone());
    repo.soft_delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
