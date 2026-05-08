use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::PurchaseOrderStatus;
use vandepot_domain::models::purchase_order::PurchaseOrder;
use vandepot_domain::models::purchase_order_line::PurchaseOrderLine;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::purchase_order_repo::{self, PurchaseOrderFilters};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use crate::pagination::PaginatedResponse;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreatePurchaseOrderRequest {
    pub supplier_id: Uuid,
    pub expected_delivery_date: Option<NaiveDate>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdatePurchaseOrderRequest {
    pub expected_delivery_date: Option<Option<NaiveDate>>,
    pub notes: Option<Option<String>>,
}

#[derive(Serialize)]
pub struct PurchaseOrderResponse {
    pub id: Uuid,
    pub supplier_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supplier_name: Option<String>,
    pub order_number: String,
    pub status: PurchaseOrderStatus,
    pub total_amount: Option<f64>,
    pub expected_delivery_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<PurchaseOrderLineResponse>>,
}

impl From<PurchaseOrder> for PurchaseOrderResponse {
    fn from(po: PurchaseOrder) -> Self {
        Self {
            id: po.id,
            supplier_id: po.supplier_id,
            supplier_name: po.supplier_name,
            order_number: po.order_number,
            status: po.status,
            total_amount: po.total_amount,
            expected_delivery_date: po.expected_delivery_date,
            notes: po.notes,
            created_by: po.created_by,
            created_at: po.created_at,
            updated_at: po.updated_at,
            lines: None,
        }
    }
}

#[derive(Serialize)]
pub struct PurchaseOrderLineResponse {
    pub id: Uuid,
    pub purchase_order_id: Uuid,
    pub product_id: Uuid,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
    pub quantity_ordered: f64,
    pub quantity_received: f64,
    pub unit_price: f64,
    pub notes: Option<String>,
}

impl From<PurchaseOrderLine> for PurchaseOrderLineResponse {
    fn from(line: PurchaseOrderLine) -> Self {
        Self {
            id: line.id,
            purchase_order_id: line.purchase_order_id,
            product_id: line.product_id,
            product_name: line.product_name,
            product_sku: line.product_sku,
            quantity_ordered: line.quantity_ordered,
            quantity_received: line.quantity_received,
            unit_price: line.unit_price,
            notes: line.notes,
        }
    }
}

#[derive(Deserialize)]
pub struct AddLineRequest {
    pub product_id: Uuid,
    pub quantity_ordered: f64,
    pub unit_price: f64,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateLineRequest {
    pub quantity_ordered: Option<f64>,
    pub unit_price: Option<f64>,
    pub notes: Option<Option<String>>,
}

#[derive(Deserialize)]
pub struct PurchaseOrderQueryParams {
    pub status: Option<PurchaseOrderStatus>,
    pub supplier_id: Option<Uuid>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl PurchaseOrderQueryParams {
    fn limit(&self) -> i64 {
        self.per_page.unwrap_or(20).min(100).max(1)
    }

    fn offset(&self) -> i64 {
        let page = self.page.unwrap_or(1).max(1);
        (page - 1) * self.limit()
    }

    fn page(&self) -> i64 {
        self.page.unwrap_or(1).max(1)
    }
}

// ── Order number generation ───────────────────────────────────────────

fn generate_order_number() -> String {
    let date = chrono::Utc::now().format("%Y%m%d");
    let suffix = Uuid::new_v4().to_string()[..4].to_uppercase();
    format!("PO-{}-{}", date, suffix)
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1..B5 per-route helper convention.
fn require_tenant_for_purchase_orders(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for purchase order operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn purchase_order_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/purchase-orders",
            post(create_purchase_order).get(list_purchase_orders),
        )
        .route(
            "/purchase-orders/{id}",
            get(get_purchase_order).put(update_purchase_order),
        )
        .route("/purchase-orders/{id}/send", post(send_purchase_order))
        .route("/purchase-orders/{id}/cancel", post(cancel_purchase_order))
        .route(
            "/purchase-orders/{id}/lines",
            post(add_line).get(get_lines),
        )
        .route(
            "/purchase-orders/{id}/lines/{line_id}",
            put(update_line).delete(delete_line),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_purchase_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreatePurchaseOrderRequest>,
) -> Result<(StatusCode, Json<PurchaseOrderResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    if let Some(ref notes) = payload.notes {
        if notes.len() > 2000 {
            return Err(ApiError(DomainError::Validation(
                "Notes cannot exceed 2000 characters".to_string(),
            )));
        }
    }

    let order_number = generate_order_number();
    let po = purchase_order_repo::create(
        &mut *tt.tx,
        tenant_id,
        payload.supplier_id,
        &order_number,
        payload.expected_delivery_date,
        payload.notes.as_deref(),
        claims.sub,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(PurchaseOrderResponse::from(po))))
}

async fn list_purchase_orders(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PurchaseOrderQueryParams>,
) -> Result<Json<PaginatedResponse<PurchaseOrderResponse>>, ApiError> {
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    let filters = PurchaseOrderFilters {
        status: params.status.clone(),
        supplier_id: params.supplier_id,
        from_date: params.from_date,
        to_date: params.to_date,
    };

        let (orders, total) = purchase_order_repo::list(
        &mut *tt.tx,
        tenant_id,
        filters,
        params.limit(),
        params.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: orders
            .into_iter()
            .map(PurchaseOrderResponse::from)
            .collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_purchase_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<PurchaseOrderResponse>, ApiError> {
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

        let po = purchase_order_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase order not found".to_string())))?;

    let lines = purchase_order_repo::get_lines(&mut *tt.tx, tenant_id, id).await?;

    let mut response = PurchaseOrderResponse::from(po);
    response.lines = Some(
        lines
            .into_iter()
            .map(PurchaseOrderLineResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn update_purchase_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdatePurchaseOrderRequest>,
) -> Result<Json<PurchaseOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    if let Some(Some(ref notes)) = payload.notes {
        if notes.len() > 2000 {
            return Err(ApiError(DomainError::Validation(
                "Notes cannot exceed 2000 characters".to_string(),
            )));
        }
    }

    let po = purchase_order_repo::update(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.expected_delivery_date,
        payload
            .notes
            .as_ref()
            .map(|n| n.as_ref().map(|s| s.as_str())),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PurchaseOrderResponse::from(po)))
}

async fn send_purchase_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<PurchaseOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    let po = purchase_order_repo::send(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PurchaseOrderResponse::from(po)))
}

async fn cancel_purchase_order(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<PurchaseOrderResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    let po = purchase_order_repo::cancel(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PurchaseOrderResponse::from(po)))
}

async fn add_line(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<AddLineRequest>,
) -> Result<(StatusCode, Json<PurchaseOrderLineResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    if payload.quantity_ordered <= 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Quantity ordered must be greater than 0".to_string(),
        )));
    }
    if payload.unit_price < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Unit price cannot be negative".to_string(),
        )));
    }
    if let Some(ref notes) = payload.notes {
        if notes.len() > 500 {
            return Err(ApiError(DomainError::Validation(
                "Line notes cannot exceed 500 characters".to_string(),
            )));
        }
    }

    // Verify PO is in draft status (tenant-scoped probe — cross-tenant id → 404).
        let po = purchase_order_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase order not found".to_string())))?;

    if po.status != PurchaseOrderStatus::Draft {
        return Err(ApiError(DomainError::Conflict(
            "Lines can only be added to orders in draft status".to_string(),
        )));
    }

    let line = purchase_order_repo::add_line(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.product_id,
        payload.quantity_ordered,
        payload.unit_price,
        payload.notes.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(PurchaseOrderLineResponse::from(line))))
}

async fn update_line(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path((id, line_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateLineRequest>,
) -> Result<Json<PurchaseOrderLineResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    if let Some(qty) = payload.quantity_ordered {
        if qty <= 0.0 {
            return Err(ApiError(DomainError::Validation(
                "Quantity ordered must be greater than 0".to_string(),
            )));
        }
    }
    if let Some(price) = payload.unit_price {
        if price < 0.0 {
            return Err(ApiError(DomainError::Validation(
                "Unit price cannot be negative".to_string(),
            )));
        }
    }
    if let Some(Some(ref notes)) = payload.notes {
        if notes.len() > 500 {
            return Err(ApiError(DomainError::Validation(
                "Line notes cannot exceed 500 characters".to_string(),
            )));
        }
    }

    // Verify PO is in draft status (tenant-scoped).
        let po = purchase_order_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase order not found".to_string())))?;

    if po.status != PurchaseOrderStatus::Draft {
        return Err(ApiError(DomainError::Conflict(
            "Lines can only be modified on orders in draft status".to_string(),
        )));
    }

    let line = purchase_order_repo::update_line(
        &mut *tt.tx,
        tenant_id,
        line_id,
        payload.quantity_ordered,
        payload.unit_price,
        payload
            .notes
            .as_ref()
            .map(|n| n.as_ref().map(|s| s.as_str())),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PurchaseOrderLineResponse::from(line)))
}

async fn delete_line(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path((id, line_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

    // Verify PO is in draft status (tenant-scoped).
        let po = purchase_order_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase order not found".to_string())))?;

    if po.status != PurchaseOrderStatus::Draft {
        return Err(ApiError(DomainError::Conflict(
            "Lines can only be deleted from orders in draft status".to_string(),
        )));
    }

    purchase_order_repo::delete_line(&mut *tt.tx, tenant_id, line_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_lines(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<PurchaseOrderLineResponse>>, ApiError> {
    let tenant_id = require_tenant_for_purchase_orders(&claims)?;

        let lines = purchase_order_repo::get_lines(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(
        lines
            .into_iter()
            .map(PurchaseOrderLineResponse::from)
            .collect(),
    ))
}
