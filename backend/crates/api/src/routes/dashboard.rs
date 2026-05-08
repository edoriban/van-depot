use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::{dashboard_repo, user_warehouse_repo};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DashboardStatsResponse {
    pub total_products: i64,
    pub total_warehouses: i64,
    pub total_locations: i64,
    pub total_stock_items: i64,
    pub low_stock_count: i64,
    pub movements_today: i64,
    pub movements_this_week: i64,
}

#[derive(Serialize)]
pub struct RecentMovementResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub from_location_id: Option<Uuid>,
    pub from_location_name: Option<String>,
    pub to_location_id: Option<Uuid>,
    pub to_location_name: Option<String>,
    pub quantity: f64,
    pub movement_type: String,
    pub user_id: Uuid,
    pub user_name: String,
    pub reference: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
pub struct LowStockItemResponse {
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub quantity: f64,
    pub min_stock: f64,
}

#[derive(Deserialize)]
pub struct LowStockQueryParams {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Deserialize)]
pub struct MovementsSummaryParams {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub warehouse_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct MovementsSummaryResponse {
    pub entries_count: i64,
    pub exits_count: i64,
    pub transfers_count: i64,
    pub adjustments_count: i64,
    pub entries_quantity: f64,
    pub exits_quantity: f64,
}

#[derive(Serialize)]
pub struct StockByCategoryResponse {
    pub category_id: Uuid,
    pub category_name: String,
    pub total_quantity: f64,
    pub product_count: i64,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn dashboard_routes() -> Router<AppState> {
    Router::new()
        .route("/dashboard/stats", get(dashboard_stats))
        .route("/dashboard/recent-movements", get(recent_movements))
        .route("/reports/low-stock", get(low_stock_report))
        .route("/reports/movements-summary", get(movements_summary))
        .route("/reports/stock-by-category", get(stock_by_category))
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Returns `None` for superadmin (sees all), `Some(ids)` for scoped users.
///
/// Post-B8.1, `user_warehouse_repo::list_for_user` filters on
/// `(tenant_id, user_id)` and the rows themselves carry a tenant_id matching
/// the active claim, so the returned warehouse_ids are tenant-correct by
/// construction.
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

// ── Handlers ────────────────────────────────────────────────────────

async fn dashboard_stats(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<DashboardStatsResponse>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let stats =
        dashboard_repo::get_dashboard_stats(&mut *tt.tx, scope.as_deref()).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(DashboardStatsResponse {
        total_products: stats.total_products,
        total_warehouses: stats.total_warehouses,
        total_locations: stats.total_locations,
        total_stock_items: stats.total_stock_items,
        low_stock_count: stats.low_stock_count,
        movements_today: stats.movements_today,
        movements_this_week: stats.movements_this_week,
    }))
}

async fn recent_movements(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<Vec<RecentMovementResponse>>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let rows =
        dashboard_repo::get_recent_movements(&mut *tt.tx, scope.as_deref()).await?;

    let items = rows
        .into_iter()
        .map(|r| RecentMovementResponse {
            id: r.id,
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            from_location_id: r.from_location_id,
            from_location_name: r.from_location_name,
            to_location_id: r.to_location_id,
            to_location_name: r.to_location_name,
            quantity: r.quantity,
            movement_type: r.movement_type,
            user_id: r.user_id,
            user_name: r.user_name,
            reference: r.reference,
            created_at: r.created_at,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(items))
}

async fn low_stock_report(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<LowStockQueryParams>,
) -> Result<Json<PaginatedResponse<LowStockItemResponse>>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let (rows, total) = dashboard_repo::get_low_stock(
        &mut *tt.tx,
        scope.as_deref(),
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    let data = rows
        .into_iter()
        .map(|r| LowStockItemResponse {
            product_id: r.product_id,
            product_name: r.product_name,
            product_sku: r.product_sku,
            location_id: r.location_id,
            location_name: r.location_name,
            warehouse_id: r.warehouse_id,
            quantity: r.quantity,
            min_stock: r.min_stock,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data,
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn movements_summary(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<MovementsSummaryParams>,
) -> Result<Json<MovementsSummaryResponse>, ApiError> {
    // If a specific warehouse is requested, verify access via the per-request
    // DB lookup (the JWT no longer carries `warehouse_ids`).
    if let Some(wid) = params.warehouse_id {
        crate::extractors::warehouse_access::ensure_warehouse_access(
            &mut *tt.tx,
            &claims,
            &wid,
        )
        .await?;
    }

    let row = dashboard_repo::get_movements_summary(
        &mut *tt.tx,
        params.start_date,
        params.end_date,
        params.warehouse_id,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(MovementsSummaryResponse {
        entries_count: row.entries_count,
        exits_count: row.exits_count,
        transfers_count: row.transfers_count,
        adjustments_count: row.adjustments_count,
        entries_quantity: row.entries_quantity,
        exits_quantity: row.exits_quantity,
    }))
}

async fn stock_by_category(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<Vec<StockByCategoryResponse>>, ApiError> {
    let scope = warehouse_scope(&mut *tt.tx, &claims).await?;
    let rows =
        dashboard_repo::get_stock_by_category(&mut *tt.tx, scope.as_deref()).await?;

    let items = rows
        .into_iter()
        .map(|r| StockByCategoryResponse {
            category_id: r.category_id,
            category_name: r.category_name,
            total_quantity: r.total_quantity,
            product_count: r.product_count,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(items))
}
