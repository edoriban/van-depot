use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::{alerts_repo, user_warehouse_repo};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
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
///
/// Resolves the user's warehouses via tenant-scoped
/// `user_warehouse_repo::list_for_user` (B8.4). Once the `Tenant` extractor
/// lands (C2/C3) this will be replaced by a per-request transaction-scoped
/// query.
async fn warehouse_scope(
    conn: &mut sqlx::PgConnection,
    claims: &Claims,
) -> Result<Option<Vec<Uuid>>, ApiError> {
    if claims.is_superadmin {
        return Ok(None);
    }
    let ctx = tenant_context_from_claims(claims);
    let tenant_id = ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required (stale or non-tenant token)".to_string(),
        ))
    })?;
    let ids = user_warehouse_repo::list_for_user(&mut *conn, tenant_id, claims.sub).await?;
    Ok(Some(ids))
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
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<StockAlertQueryParams>,
) -> Result<Json<Vec<StockAlertResponse>>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let rows = alerts_repo::get_stock_alerts(
        &mut *tt.tx,
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(items))
}

async fn alert_summary(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<AlertSummaryResponse>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let row =
        alerts_repo::get_alert_summary(&mut *tt.tx, scope.as_deref()).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(AlertSummaryResponse {
        critical_count: row.critical_count,
        low_count: row.low_count,
        warning_count: row.warning_count,
        total_alerts: row.total_alerts,
    }))
}
