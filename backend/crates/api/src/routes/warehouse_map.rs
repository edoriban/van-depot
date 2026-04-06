use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::warehouse_map_repo;

use crate::error::ApiError;
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
    pub summary: MapSummaryResponse,
    pub zones: Vec<ZoneHealthResponse>,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn warehouse_map_routes() -> Router<AppState> {
    Router::new().route(
        "/warehouses/{warehouse_id}/map",
        get(get_warehouse_map),
    )
}

// ── Handlers ────────────────────────────────────────────────────────

async fn get_warehouse_map(
    State(state): State<AppState>,
    claims: Claims,
    Path(warehouse_id): Path<Uuid>,
) -> Result<Json<WarehouseMapResponse>, ApiError> {
    ensure_warehouse_access(&claims, &warehouse_id)?;

    let rows =
        warehouse_map_repo::get_warehouse_map(&state.pool, warehouse_id)
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
        })
        .collect();

    Ok(Json(WarehouseMapResponse { summary, zones }))
}
