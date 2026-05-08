use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{PurchaseReturnReason, PurchaseReturnStatus};
use vandepot_domain::models::inventory_params::ExitParams;
use vandepot_domain::models::purchase_return::{PurchaseReturn, PurchaseReturnItem};
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::{inventory_repo, purchase_return_repo};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use crate::pagination::PaginatedResponse;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReturnItemRequest {
    pub product_id: Uuid,
    pub quantity_returned: f64,
    pub quantity_original: f64,
    pub unit_price: f64,
    /// Required if the parent CreateReturnRequest has decrease_inventory = true
    pub from_location_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct CreateReturnRequest {
    pub purchase_order_id: Uuid,
    pub reason: String,
    pub reason_notes: Option<String>,
    pub decrease_inventory: Option<bool>,
    pub refund_amount: Option<f64>,
    pub items: Vec<ReturnItemRequest>,
}

#[derive(Deserialize)]
pub struct UpdateReturnRequest {
    pub status: Option<String>,
    pub refund_amount: Option<f64>,
}

#[derive(Deserialize)]
pub struct ListReturnsQuery {
    pub purchase_order_id: Option<Uuid>,
    pub status: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl ListReturnsQuery {
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

// ── Response types ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PurchaseReturnResponse {
    pub id: Uuid,
    pub purchase_order_id: Uuid,
    pub return_number: String,
    pub status: PurchaseReturnStatus,
    pub reason: PurchaseReturnReason,
    pub reason_notes: Option<String>,
    pub subtotal: f64,
    pub total: f64,
    pub refund_amount: Option<f64>,
    pub decrease_inventory: bool,
    pub requested_by_id: Uuid,
    pub shipped_at: Option<DateTime<Utc>>,
    pub refunded_at: Option<DateTime<Utc>>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<PurchaseReturnItemResponse>>,
}

impl From<PurchaseReturn> for PurchaseReturnResponse {
    fn from(r: PurchaseReturn) -> Self {
        Self {
            id: r.id,
            purchase_order_id: r.purchase_order_id,
            return_number: r.return_number,
            status: r.status,
            reason: r.reason,
            reason_notes: r.reason_notes,
            subtotal: r.subtotal,
            total: r.total,
            refund_amount: r.refund_amount,
            decrease_inventory: r.decrease_inventory,
            requested_by_id: r.requested_by_id,
            shipped_at: r.shipped_at,
            refunded_at: r.refunded_at,
            rejected_at: r.rejected_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            items: None,
        }
    }
}

#[derive(Serialize)]
pub struct PurchaseReturnItemResponse {
    pub id: Uuid,
    pub purchase_return_id: Uuid,
    pub product_id: Uuid,
    pub quantity_returned: f64,
    pub quantity_original: f64,
    pub unit_price: f64,
    pub subtotal: f64,
}

impl From<PurchaseReturnItem> for PurchaseReturnItemResponse {
    fn from(item: PurchaseReturnItem) -> Self {
        Self {
            id: item.id,
            purchase_return_id: item.purchase_return_id,
            product_id: item.product_id,
            quantity_returned: item.quantity_returned,
            quantity_original: item.quantity_original,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

fn parse_reason(reason: &str) -> Result<PurchaseReturnReason, ApiError> {
    match reason {
        "damaged" => Ok(PurchaseReturnReason::Damaged),
        "defective" => Ok(PurchaseReturnReason::Defective),
        "wrong_product" => Ok(PurchaseReturnReason::WrongProduct),
        "expired" => Ok(PurchaseReturnReason::Expired),
        "excess_inventory" => Ok(PurchaseReturnReason::ExcessInventory),
        "other" => Ok(PurchaseReturnReason::Other),
        other => Err(ApiError(DomainError::Validation(format!(
            "Invalid reason: '{}'. Valid values: damaged, defective, wrong_product, expired, excess_inventory, other",
            other
        )))),
    }
}

fn parse_return_status(status: &str) -> Result<PurchaseReturnStatus, ApiError> {
    match status {
        "pending" => Ok(PurchaseReturnStatus::Pending),
        "shipped_to_supplier" => Ok(PurchaseReturnStatus::ShippedToSupplier),
        "refunded" => Ok(PurchaseReturnStatus::Refunded),
        "rejected" => Ok(PurchaseReturnStatus::Rejected),
        other => Err(ApiError(DomainError::Validation(format!(
            "Invalid status: '{}'. Valid values: pending, shipped_to_supplier, refunded, rejected",
            other
        )))),
    }
}

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1..B5 per-route helper convention.
fn require_tenant_for_purchase_returns(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for purchase return operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn purchase_return_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/purchase-returns",
            post(create_purchase_return).get(list_purchase_returns),
        )
        .route(
            "/purchase-returns/{id}",
            get(get_purchase_return)
                .put(update_purchase_return)
                .delete(delete_purchase_return),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_purchase_return(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateReturnRequest>,
) -> Result<(StatusCode, Json<PurchaseReturnResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_returns(&claims)?;

    if payload.items.is_empty() {
        return Err(ApiError(DomainError::Validation(
            "Return must have at least one item".to_string(),
        )));
    }

    let decrease_inventory = payload.decrease_inventory.unwrap_or(true);

    for item in &payload.items {
        if item.quantity_returned <= 0.0 {
            return Err(ApiError(DomainError::Validation(
                "quantity_returned must be greater than 0".to_string(),
            )));
        }
        if item.quantity_original <= 0.0 {
            return Err(ApiError(DomainError::Validation(
                "quantity_original must be greater than 0".to_string(),
            )));
        }
        if item.unit_price < 0.0 {
            return Err(ApiError(DomainError::Validation(
                "unit_price cannot be negative".to_string(),
            )));
        }
        if decrease_inventory && item.from_location_id.is_none() {
            return Err(ApiError(DomainError::Validation(
                "from_location_id is required for each item when decrease_inventory is true"
                    .to_string(),
            )));
        }
    }

    let reason = parse_reason(&payload.reason)?;

    // Generate return number (tenant-scoped count). Two tenants creating
    // returns in the same year now coexist without colliding because the
    // UNIQUE is `(tenant_id, return_number)` post-B6.
    let year = chrono::Utc::now().year();
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM purchase_returns \
         WHERE EXTRACT(YEAR FROM created_at) = $1 AND tenant_id = $2",
    )
    .bind(year)
    .bind(tenant_id)
    .fetch_one(&mut *tt.tx)
    .await
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let return_number = format!("PR-{}-{:04}", year, count.0 + 1);

    let items: Vec<(Uuid, f64, f64, f64)> = payload
        .items
        .iter()
        .map(|i| (i.product_id, i.quantity_returned, i.quantity_original, i.unit_price))
        .collect();

    let purchase_return = purchase_return_repo::create(
        &mut *tt.tx,
        tenant_id,
        payload.purchase_order_id,
        &return_number,
        reason,
        payload.reason_notes.as_deref(),
        decrease_inventory,
        payload.refund_amount,
        claims.sub,
        items,
    )
    .await?;

    // If decrease_inventory: create stock EXIT movements for each item.
    // Phase B B6: tenant_id is the same one we passed to create() — the
    // composite FKs guarantee inventory and movement rows agree on tenant.
    if decrease_inventory {
        for item in &payload.items {
            if let Some(from_location_id) = item.from_location_id {
                inventory_repo::record_exit(
                    &mut *tt.tx,
                    tenant_id,
                    ExitParams {
                        product_id: item.product_id,
                        from_location_id,
                        quantity: item.quantity_returned,
                        user_id: claims.sub,
                        reference: Some(return_number.clone()),
                        notes: Some(format!(
                            "Purchase return {}",
                            return_number
                        )),
                    },
                )
                .await?;
            }
        }
    }

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((
        StatusCode::CREATED,
        Json(PurchaseReturnResponse::from(purchase_return)),
    ))
}

async fn list_purchase_returns(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<ListReturnsQuery>,
) -> Result<Json<PaginatedResponse<PurchaseReturnResponse>>, ApiError> {
    let tenant_id = require_tenant_for_purchase_returns(&claims)?;

    let status = params
        .status
        .as_deref()
        .map(parse_return_status)
        .transpose()?;

        let (returns, total) = purchase_return_repo::list(
        &mut *tt.tx,
        tenant_id,
        params.purchase_order_id,
        status,
        params.limit(),
        params.offset(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: returns
            .into_iter()
            .map(PurchaseReturnResponse::from)
            .collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_purchase_return(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<PurchaseReturnResponse>, ApiError> {
    let tenant_id = require_tenant_for_purchase_returns(&claims)?;

        let pr = purchase_return_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase return not found".to_string())))?;

    let items = purchase_return_repo::get_items(&mut *tt.tx, tenant_id, id).await?;

    let mut response = PurchaseReturnResponse::from(pr);
    response.items = Some(
        items
            .into_iter()
            .map(PurchaseReturnItemResponse::from)
            .collect(),
    );

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(response))
}

async fn update_purchase_return(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateReturnRequest>,
) -> Result<Json<PurchaseReturnResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_returns(&claims)?;

    let status = payload
        .status
        .as_deref()
        .map(parse_return_status)
        .transpose()?;

    let updated = match status {
        Some(s) => {
            purchase_return_repo::update_status(&mut *tt.tx, tenant_id, id, s, payload.refund_amount)
                .await?
        }
        None => {
            // No status change — find and return current.
                        purchase_return_repo::find_by_id(&mut *tt.tx, tenant_id, id)
                .await?
                .ok_or_else(|| {
                    ApiError(DomainError::NotFound("Purchase return not found".to_string()))
                })?
        }
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PurchaseReturnResponse::from(updated)))
}

async fn delete_purchase_return(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_purchase_returns(&claims)?;

    purchase_return_repo::delete(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
