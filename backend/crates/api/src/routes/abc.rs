use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::abc_repo;

use crate::error::ApiError;
use crate::state::AppState;

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AbcQueryParams {
    pub period: Option<i64>,
    pub warehouse_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct AbcItem {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub movement_count: i64,
    pub total_quantity: f64,
    pub classification: String,
    pub cumulative_percentage: f64,
}

#[derive(Serialize)]
pub struct AbcSummary {
    pub a_count: i64,
    pub b_count: i64,
    pub c_count: i64,
    pub a_movement_percentage: f64,
    pub b_movement_percentage: f64,
    pub c_movement_percentage: f64,
}

#[derive(Serialize)]
pub struct AbcReport {
    pub items: Vec<AbcItem>,
    pub summary: AbcSummary,
    pub period_days: i64,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn abc_routes() -> Router<AppState> {
    Router::new().route("/reports/abc-classification", get(abc_classification))
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

// ── Handlers ────────────────────────────────────────────────────────

async fn abc_classification(
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<AbcQueryParams>,
) -> Result<Json<AbcReport>, ApiError> {
    let period_days = params.period.unwrap_or(90);

    // If a specific warehouse is requested, verify access
    if let Some(wid) = params.warehouse_id {
        if !claims.role.eq_ignore_ascii_case("superadmin")
            && !claims.warehouse_ids.contains(&wid)
        {
            return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
                "Access denied to this warehouse".to_string(),
            )));
        }
    }

    // Determine effective warehouse_id for the query
    let effective_warehouse_id = if params.warehouse_id.is_some() {
        params.warehouse_id
    } else {
        // For non-superadmin without explicit warehouse, use first assigned warehouse
        let scope = warehouse_scope(&claims);
        scope.and_then(|ids| ids.first().copied())
    };

    let rows = abc_repo::get_abc_classification(
        &state.pool,
        period_days,
        effective_warehouse_id,
    )
    .await?;

    let total_movements: i64 = rows.iter().map(|r| r.movement_count).sum();

    let a_count = rows.iter().filter(|r| r.classification == "A").count() as i64;
    let b_count = rows.iter().filter(|r| r.classification == "B").count() as i64;
    let c_count = rows.iter().filter(|r| r.classification == "C").count() as i64;

    let a_movements: i64 = rows
        .iter()
        .filter(|r| r.classification == "A")
        .map(|r| r.movement_count)
        .sum();
    let b_movements: i64 = rows
        .iter()
        .filter(|r| r.classification == "B")
        .map(|r| r.movement_count)
        .sum();
    let c_movements: i64 = rows
        .iter()
        .filter(|r| r.classification == "C")
        .map(|r| r.movement_count)
        .sum();

    let total_f = if total_movements > 0 {
        total_movements as f64
    } else {
        1.0
    };

    let items = rows
        .into_iter()
        .map(|r| AbcItem {
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            movement_count: r.movement_count,
            total_quantity: r.total_quantity,
            classification: r.classification,
            cumulative_percentage: r.cumulative_percentage,
        })
        .collect();

    Ok(Json(AbcReport {
        items,
        summary: AbcSummary {
            a_count,
            b_count,
            c_count,
            a_movement_percentage: (a_movements as f64 / total_f) * 100.0,
            b_movement_percentage: (b_movements as f64 / total_f) * 100.0,
            c_movement_percentage: (c_movements as f64 / total_f) * 100.0,
        },
        period_days,
    }))
}
