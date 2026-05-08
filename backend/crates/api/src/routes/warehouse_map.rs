use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::warehouse_map_repo;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role_claims;
use crate::extractors::tenant::Tenant;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::extractors::warehouse_access::ensure_warehouse_access;
use crate::state::AppState;

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ZoneHealthResponse {
    pub zone_id: Uuid,
    pub zone_name: String,
    pub severity: String,
    pub critical_count: i64,
    pub low_count: i64,
    pub warning_count: i64,
    pub ok_count: i64,
    pub total_items: i64,
    pub child_location_count: i64,
    pub pos_x: Option<f32>,
    pub pos_y: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
}

#[derive(Serialize)]
pub struct MapSummaryResponse {
    pub total_zones: usize,
    pub critical_zones: usize,
    pub low_zones: usize,
    pub warning_zones: usize,
    pub ok_zones: usize,
    pub empty_zones: usize,
}

#[derive(Serialize)]
pub struct WarehouseMapResponse {
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
    pub summary: MapSummaryResponse,
    pub zones: Vec<ZoneHealthResponse>,
}

// ── Layout DTOs (T05) ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateLayoutRequest {
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
    pub locations: Vec<LocationPosition>,
}

#[derive(Deserialize)]
pub struct LocationPosition {
    pub id: Uuid,
    pub pos_x: f32,
    pub pos_y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize)]
pub struct UpdateLayoutResponse {
    pub updated: u64,
}

// ── Search DTOs (T21) ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct MapSearchParams {
    pub q: String,
}

#[derive(Serialize)]
pub struct MapSearchResult {
    pub zone_id: Uuid,
    pub zone_name: String,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub quantity: f64,
    pub location_name: String,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn warehouse_map_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/warehouses/{warehouse_id}/map",
            get(get_warehouse_map),
        )
        .route(
            "/warehouses/{warehouse_id}/map/search",
            get(search_map),
        )
        .route(
            "/warehouses/{warehouse_id}/layout",
            put(update_layout),
        )
}

// ── Handlers ────────────────────────────────────────────────────────

async fn get_warehouse_map(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
) -> Result<Json<WarehouseMapResponse>, ApiError> {
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let rows =
        warehouse_map_repo::get_warehouse_map(&mut *tt.tx, warehouse_id)
            .await?;

    let canvas =
        warehouse_map_repo::get_canvas_dimensions(&mut *tt.tx, warehouse_id)
            .await?;

    let summary = MapSummaryResponse {
        total_zones: rows.len(),
        critical_zones: rows.iter().filter(|z| z.severity == "critical").count(),
        low_zones: rows.iter().filter(|z| z.severity == "low").count(),
        warning_zones: rows.iter().filter(|z| z.severity == "warning").count(),
        ok_zones: rows.iter().filter(|z| z.severity == "ok").count(),
        empty_zones: rows.iter().filter(|z| z.severity == "empty").count(),
    };

    let zones = rows
        .into_iter()
        .map(|r| ZoneHealthResponse {
            zone_id: r.zone_id,
            zone_name: r.zone_name,
            severity: r.severity,
            critical_count: r.critical_count,
            low_count: r.low_count,
            warning_count: r.warning_count,
            ok_count: r.ok_count,
            total_items: r.total_items,
            child_location_count: r.child_location_count,
            pos_x: r.pos_x,
            pos_y: r.pos_y,
            width: r.width,
            height: r.height,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(WarehouseMapResponse {
        canvas_width: canvas.canvas_width,
        canvas_height: canvas.canvas_height,
        summary,
        zones,
    }))
}

async fn update_layout(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Json(payload): Json<UpdateLayoutRequest>,
) -> Result<Json<UpdateLayoutResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let locations: Vec<(Uuid, f32, f32, f32, f32)> = payload
        .locations
        .iter()
        .map(|l| (l.id, l.pos_x, l.pos_y, l.width, l.height))
        .collect();

    let updated = warehouse_map_repo::update_layout(
        &mut *tt.tx,
        warehouse_id,
        payload.canvas_width,
        payload.canvas_height,
        &locations,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(UpdateLayoutResponse { updated }))
}

// ── T21: Map search handler ────────────────────────────────────────

async fn search_map(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
    Query(params): Query<MapSearchParams>,
) -> Result<Json<Vec<MapSearchResult>>, ApiError> {
    ensure_warehouse_access(&mut *tt.tx, &claims, &warehouse_id).await?;

    let q = params.q.trim();
    if q.len() < 2 {
        return Ok(Json(vec![]));
    }

    let rows =
        warehouse_map_repo::search_map(&mut *tt.tx, warehouse_id, q)
            .await?;

    let results = rows
        .into_iter()
        .map(|r| MapSearchResult {
            zone_id: r.zone_id,
            zone_name: r.zone_name,
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            quantity: r.quantity,
            location_name: r.location_name,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(results))
}
