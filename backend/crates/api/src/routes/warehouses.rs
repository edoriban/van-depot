use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::warehouse::Warehouse;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::user_warehouse_repo;
use vandepot_infra::repositories::warehouse_repo::{self, WarehouseWithStatsRow};

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

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 400
/// with a clear message for superadmin tokens (out of scope for Phase B —
/// cross-tenant superadmin endpoints arrive post-v1).
///
/// TODO(post-v1): superadmin can pass `?tenant_id=...` for cross-tenant
/// listings; not implemented for Phase B per design §5.5.
fn require_tenant_for_warehouses(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for warehouse operations (superadmin must select a tenant)".to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateWarehouseRequest>,
) -> Result<(StatusCode, Json<WarehouseResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_warehouses(&claims)?;

        let warehouse = warehouse_repo::create(
        &mut *tt.tx,
        tenant_id,
        &payload.name,
        payload.address.as_deref(),
    )
    .await?;

    // The list handler filters non-superadmin callers by `user_warehouses`,
    // so without this grant the creator would create a warehouse they
    // immediately cannot see. Superadmins skip because they have no
    // `user_tenants` row to satisfy the composite FK on
    // `user_warehouses(tenant_id, user_id)`.
    if !claims.is_superadmin {
        user_warehouse_repo::assign(&mut *tt.tx, tenant_id, claims.sub, warehouse.id).await?;
    }

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(WarehouseResponse::from(warehouse))))
}

async fn list_warehouses(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<WarehouseResponse>>, ApiError> {
    let tenant_id = require_tenant_for_warehouses(&claims)?;

        let (warehouses, total) =
        warehouse_repo::list(&mut *tt.tx, tenant_id, params.limit(), params.offset()).await?;

    // Within a tenant, non-superadmins still see only the warehouses they're
    // assigned to via `user_warehouses`. Superadmins (who reach this branch
    // only if they explicitly carry a tenant claim post-v1) see every
    // warehouse in the tenant.
    let filtered: Vec<WarehouseResponse> = if claims.is_superadmin {
        warehouses.into_iter().map(WarehouseResponse::from).collect()
    } else {
        let allowed =
            user_warehouse_repo::list_for_user(&mut *tt.tx, tenant_id, claims.sub).await?;
        warehouses
            .into_iter()
            .filter(|w| allowed.contains(&w.id))
            .map(WarehouseResponse::from)
            .collect()
    };

    let filtered_total = if claims.is_superadmin {
        total
    } else {
        filtered.len() as i64
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: filtered,
        total: filtered_total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn list_warehouses_with_stats(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<WarehouseWithStatsResponse>>, ApiError> {
    let tenant_id = require_tenant_for_warehouses(&claims)?;

        let (rows, total) = warehouse_repo::list_with_stats(
        &mut *tt.tx,
        tenant_id,
        params.limit(),
        params.offset(),
    )
    .await?;

    let filtered: Vec<WarehouseWithStatsResponse> = if claims.is_superadmin {
        rows.into_iter()
            .map(WarehouseWithStatsResponse::from)
            .collect()
    } else {
        let allowed =
            user_warehouse_repo::list_for_user(&mut *tt.tx, tenant_id, claims.sub).await?;
        rows.into_iter()
            .filter(|r| allowed.contains(&r.id))
            .map(WarehouseWithStatsResponse::from)
            .collect()
    };

    let filtered_total = if claims.is_superadmin {
        total
    } else {
        filtered.len() as i64
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: filtered,
        total: filtered_total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<WarehouseResponse>, ApiError> {
    let tenant_id = require_tenant_for_warehouses(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &id).await?;

        let warehouse = warehouse_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Warehouse not found".to_string())))?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(WarehouseResponse::from(warehouse)))
}

async fn update_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateWarehouseRequest>,
) -> Result<Json<WarehouseResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_warehouses(&claims)?;
    ensure_warehouse_access(&mut *tt.tx, &claims, &id).await?;

        let warehouse = warehouse_repo::update(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.name.as_deref(),
        payload.address.as_ref().map(|a| a.as_deref()),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(WarehouseResponse::from(warehouse)))
}

async fn delete_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    // Empty allowlist: only superadmin may hard-delete a warehouse. Same
    // policy as before the refactor.
    require_role_claims(&claims, &[])?;
    let tenant_id = require_tenant_for_warehouses(&claims)?;

        warehouse_repo::soft_delete(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
