// Work Orders route module — wires the WO state machine (create / issue /
// complete / cancel) over HTTP. Mirrors the DTO + role-guard conventions
// established by `recipes.rs` and `purchase_orders.rs` (design §7a).
//
// JWT-only: GET /work-orders, GET /work-orders/{id}
// Role-guarded (superadmin | owner | warehouse_manager | operator):
//   POST /work-orders, POST /work-orders/{id}/issue,
//   POST /work-orders/{id}/complete, POST /work-orders/{id}/cancel
//
// Phase B B5 — every handler also calls `require_tenant_for_work_orders`
// to extract the active tenant_id from the caller's claims (422 if a
// superadmin token has not selected one), then threads tenant_id into
// every repo call. The free-function repo enforces `WHERE tenant_id`
// on every query, and the composite FKs installed by 20260508000005
// reject any cross-tenant INSERT/UPDATE at the DB layer.
//
// Structured 409 + 422 error bodies flow automatically through
// `ApiError::into_response` (see `crates/api/src/error.rs`).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::WorkOrderStatus;
use vandepot_domain::models::work_order::{WorkOrder, WorkOrderMaterial};
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::work_orders_repo;
use vandepot_infra::repositories::work_orders_repo::{
    CreateWorkOrderParams, MaterialSourceOverride, WorkOrderFilters,
};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;
use vandepot_infra::auth::tenant_context::TenantRole;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWorkOrderRequest {
    pub recipe_id: Uuid,
    pub fg_product_id: Uuid,
    pub fg_quantity: f64,
    pub warehouse_id: Uuid,
    pub work_center_location_id: Uuid,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct WorkOrderListParams {
    pub status: Option<WorkOrderStatus>,
    pub warehouse_id: Option<Uuid>,
    pub work_center_location_id: Option<Uuid>,
    /// Substring match against the WO `code` or FG product name.
    pub search: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Deserialize)]
pub struct MaterialSourceDto {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
}

impl From<MaterialSourceDto> for MaterialSourceOverride {
    fn from(dto: MaterialSourceDto) -> Self {
        Self {
            product_id: dto.product_id,
            from_location_id: dto.from_location_id,
        }
    }
}

#[derive(Deserialize, Default)]
pub struct IssueWorkOrderRequest {
    /// Optional per-material source overrides. When omitted the repo
    /// auto-picks the highest-qty non-reception/work_center/finished_good
    /// location in the same warehouse (design §3b).
    #[serde(default)]
    pub material_sources: Option<Vec<MaterialSourceDto>>,
}

#[derive(Deserialize, Default)]
pub struct CompleteWorkOrderRequest {
    /// Required when the FG product has `has_expiry=true`; ignored otherwise
    /// (the repo stores NULL for non-expirable FGs).
    pub fg_expiration_date: Option<NaiveDate>,
    pub notes: Option<String>,
}

/// Cancel has no body today — the repo reverses any `wo_issue` movements
/// using data already on record. An empty body is accepted for symmetry
/// with the other actions.
#[derive(Deserialize, Default)]
pub struct CancelWorkOrderRequest {}

#[derive(Serialize)]
pub struct WorkOrderResponse {
    pub id: Uuid,
    pub code: String,
    pub recipe_id: Uuid,
    pub fg_product_id: Uuid,
    pub fg_quantity: f64,
    pub status: WorkOrderStatus,
    pub warehouse_id: Uuid,
    pub work_center_location_id: Uuid,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub issued_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materials: Option<Vec<WorkOrderMaterialResponse>>,
}

impl From<WorkOrder> for WorkOrderResponse {
    fn from(wo: WorkOrder) -> Self {
        Self {
            id: wo.id,
            code: wo.code,
            recipe_id: wo.recipe_id,
            fg_product_id: wo.fg_product_id,
            fg_quantity: wo.fg_quantity,
            status: wo.status,
            warehouse_id: wo.warehouse_id,
            work_center_location_id: wo.work_center_location_id,
            notes: wo.notes,
            created_by: wo.created_by,
            created_at: wo.created_at,
            issued_at: wo.issued_at,
            completed_at: wo.completed_at,
            cancelled_at: wo.cancelled_at,
            updated_at: wo.updated_at,
            materials: None,
        }
    }
}

#[derive(Serialize)]
pub struct WorkOrderMaterialResponse {
    pub id: Uuid,
    pub work_order_id: Uuid,
    pub product_id: Uuid,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
    pub quantity_expected: f64,
    pub quantity_consumed: f64,
    pub notes: Option<String>,
}

impl From<WorkOrderMaterial> for WorkOrderMaterialResponse {
    fn from(m: WorkOrderMaterial) -> Self {
        Self {
            id: m.id,
            work_order_id: m.work_order_id,
            product_id: m.product_id,
            product_name: m.product_name,
            product_sku: m.product_sku,
            quantity_expected: m.quantity_expected,
            quantity_consumed: m.quantity_consumed,
            notes: m.notes,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1/B2/B3/B4 per-route helper convention.
fn require_tenant_for_work_orders(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for work order operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn work_order_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/work-orders",
            post(create_work_order).get(list_work_orders),
        )
        .route("/work-orders/{id}", get(get_work_order))
        .route("/work-orders/{id}/issue", post(issue_work_order))
        .route("/work-orders/{id}/complete", post(complete_work_order))
        .route("/work-orders/{id}/cancel", post(cancel_work_order))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_work_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateWorkOrderRequest>,
) -> Result<(StatusCode, Json<WorkOrderResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager, TenantRole::Operator])?;
    let tenant_id = require_tenant_for_work_orders(&claims)?;

    if payload.fg_quantity <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "fg_quantity must be greater than 0".to_string(),
        )));
    }
    if let Some(ref notes) = payload.notes {
        if notes.len() > 2000 {
            return Err(ApiError(DomainError::Validation(
                "Notes cannot exceed 2000 characters".to_string(),
            )));
        }
    }

    let wo = work_orders_repo::create(
        &mut *tt.tx,
        tenant_id,
        CreateWorkOrderParams {
            recipe_id: payload.recipe_id,
            fg_product_id: payload.fg_product_id,
            fg_quantity: payload.fg_quantity,
            warehouse_id: payload.warehouse_id,
            work_center_location_id: payload.work_center_location_id,
            notes: payload.notes,
            created_by: claims.sub,
        },
    )
    .await?;

    // Hydrate materials inline on the 201 response so the client can render
    // the BOM snapshot without a follow-up fetch.
        let materials = work_orders_repo::list_materials(&mut *tt.tx, tenant_id, wo.id).await?;
    let mut response = WorkOrderResponse::from(wo);
    response.materials = Some(
        materials
            .into_iter()
            .map(WorkOrderMaterialResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn list_work_orders(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<WorkOrderListParams>,
) -> Result<Json<PaginatedResponse<WorkOrderResponse>>, ApiError> {
    let tenant_id = require_tenant_for_work_orders(&claims)?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };

    let filters = WorkOrderFilters {
        status: params.status,
        warehouse_id: params.warehouse_id,
        work_center_location_id: params.work_center_location_id,
        search: params.search,
    };

        let (orders, total) = work_orders_repo::list(
        &mut *tt.tx,
        tenant_id,
        filters,
        pagination.limit(),
        pagination.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: orders.into_iter().map(WorkOrderResponse::from).collect(),
        total,
        page: pagination.page(),
        per_page: pagination.limit(),
    }))
}

async fn get_work_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkOrderResponse>, ApiError> {
    let tenant_id = require_tenant_for_work_orders(&claims)?;

        let wo = work_orders_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Work order not found".to_string())))?;

    let materials = work_orders_repo::list_materials(&mut *tt.tx, tenant_id, id).await?;

    let mut response = WorkOrderResponse::from(wo);
    response.materials = Some(
        materials
            .into_iter()
            .map(WorkOrderMaterialResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn issue_work_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<IssueWorkOrderRequest>,
) -> Result<Json<WorkOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager, TenantRole::Operator])?;
    let tenant_id = require_tenant_for_work_orders(&claims)?;

    let overrides: Vec<MaterialSourceOverride> = payload
        .material_sources
        .unwrap_or_default()
        .into_iter()
        .map(MaterialSourceOverride::from)
        .collect();

    let result = work_orders_repo::issue(&mut *tt.tx, tenant_id, id, claims.sub, overrides).await?;

        let materials = work_orders_repo::list_materials(&mut *tt.tx, tenant_id, result.work_order.id).await?;
    let mut response = WorkOrderResponse::from(result.work_order);
    response.materials = Some(
        materials
            .into_iter()
            .map(WorkOrderMaterialResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn complete_work_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<CompleteWorkOrderRequest>,
) -> Result<Json<WorkOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager, TenantRole::Operator])?;
    let tenant_id = require_tenant_for_work_orders(&claims)?;

    if let Some(ref notes) = payload.notes {
        if notes.len() > 2000 {
            return Err(ApiError(DomainError::Validation(
                "Notes cannot exceed 2000 characters".to_string(),
            )));
        }
    }

    let result = work_orders_repo::complete(
        &mut *tt.tx,
        tenant_id,
        id,
        claims.sub,
        payload.fg_expiration_date,
    )
    .await?;

        let materials = work_orders_repo::list_materials(&mut *tt.tx, tenant_id, result.work_order.id).await?;
    let mut response = WorkOrderResponse::from(result.work_order);
    response.materials = Some(
        materials
            .into_iter()
            .map(WorkOrderMaterialResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn cancel_work_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    // Accept an optional empty body — axum's Json extractor would reject
    // missing bodies, so we extract via Option<Json<..>> with a default.
    body: Option<Json<CancelWorkOrderRequest>>,
) -> Result<Json<WorkOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager, TenantRole::Operator])?;
    let tenant_id = require_tenant_for_work_orders(&claims)?;

    let _ = body;

    let result = work_orders_repo::cancel(&mut *tt.tx, tenant_id, id, claims.sub).await?;

        let materials = work_orders_repo::list_materials(&mut *tt.tx, tenant_id, result.work_order.id).await?;
    let mut response = WorkOrderResponse::from(result.work_order);
    response.materials = Some(
        materials
            .into_iter()
            .map(WorkOrderMaterialResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}
