use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::alerts_repo;

use crate::error::ApiError;
use crate::state::AppState;

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct StockAlertResponse {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub warehouse_name: String,
    pub current_quantity: f64,
    pub min_stock: f64,
    pub deficit: f64,
    pub severity: String,
}

#[derive(Serialize)]
pub struct AlertSummaryResponse {
    pub critical_count: i64,
    pub low_count: i64,
    pub warning_count: i64,
    pub total_alerts: i64,
}

#[derive(Deserialize)]
pub struct StockAlertQueryParams {
    pub warehouse_id: Option<Uuid>,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn alert_routes() -> Router<AppState> {
    Router::new()
        .route("/alerts/stock", get(stock_alerts))
        .route("/alerts/summary", get(alert_summary))
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Returns `None` for superadmin (sees all), `Some(ids)` for scoped users.
fn warehouse_scope(claims: &Claims) -> Option<Vec<Uuid>> {
    if claims.role.eq_ignore_ascii_case("superadmin") {
        None
    } else {
        Some(claims.warehouse_ids.clone())
    }
}

/// Compute severity based on quantity/min_stock ratio.
fn compute_severity(current_quantity: f64, min_stock: f64) -> String {
    if current_quantity == 0.0 {
        "critical".to_string()
    } else if current_quantity <= min_stock * 0.5 {
        "low".to_string()
    } else {
        "warning".to_string()
    }
}

// ── Handlers ────────────────────────────────────────────────────────

async fn stock_alerts(
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<StockAlertQueryParams>,
) -> Result<Json<Vec<StockAlertResponse>>, ApiError> {
    let scope = warehouse_scope(&claims);
    let rows = alerts_repo::get_stock_alerts(
        &state.pool,
        scope.as_deref(),
        params.warehouse_id,
    )
    .await?;

    let items = rows
        .into_iter()
        .map(|r| StockAlertResponse {
            severity: compute_severity(r.current_quantity, r.min_stock),
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            location_id: r.location_id,
            location_name: r.location_name,
            warehouse_id: r.warehouse_id,
            warehouse_name: r.warehouse_name,
            current_quantity: r.current_quantity,
            min_stock: r.min_stock,
            deficit: r.deficit,
        })
        .collect();

    Ok(Json(items))
}

async fn alert_summary(
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<AlertSummaryResponse>, ApiError> {
    let scope = warehouse_scope(&claims);
    let row =
        alerts_repo::get_alert_summary(&state.pool, scope.as_deref()).await?;

    Ok(Json(AlertSummaryResponse {
        critical_count: row.critical_count,
        low_count: row.low_count,
        warning_count: row.warning_count,
        total_alerts: row.total_alerts,
    }))
}
