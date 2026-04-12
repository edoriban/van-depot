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
use vandepot_domain::ports::purchase_return_repository::PurchaseReturnRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::inventory_repo::PgInventoryService;
use vandepot_infra::repositories::purchase_return_repo::PgPurchaseReturnRepository;
use vandepot_domain::ports::inventory_service::InventoryService;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
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

// ── Return number generation ──────────────────────────────────────────

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
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateReturnRequest>,
) -> Result<(StatusCode, Json<PurchaseReturnResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

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

    let repo = PgPurchaseReturnRepository::new(state.pool.clone());

    // Generate return number using year + sequential count
    let year = chrono::Utc::now().year();
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM purchase_returns WHERE EXTRACT(YEAR FROM created_at) = $1",
    )
    .bind(year)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let return_number = format!("PR-{}-{:04}", year, count.0 + 1);

    let items: Vec<(Uuid, f64, f64, f64)> = payload
        .items
        .iter()
        .map(|i| (i.product_id, i.quantity_returned, i.quantity_original, i.unit_price))
        .collect();

    let purchase_return = repo
        .create(
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

    // If decrease_inventory: create stock EXIT movements for each item
    if decrease_inventory {
        let inventory_svc = PgInventoryService::new(state.pool.clone());
        for item in &payload.items {
            if let Some(from_location_id) = item.from_location_id {
                inventory_svc
                    .record_exit(ExitParams {
                        product_id: item.product_id,
                        from_location_id,
                        quantity: item.quantity_returned,
                        user_id: claims.sub,
                        reference: Some(return_number.clone()),
                        notes: Some(format!(
                            "Purchase return {}",
                            return_number
                        )),
                    })
                    .await?;
            }
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(PurchaseReturnResponse::from(purchase_return)),
    ))
}

async fn list_purchase_returns(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<ListReturnsQuery>,
) -> Result<Json<PaginatedResponse<PurchaseReturnResponse>>, ApiError> {
    let status = params
        .status
        .as_deref()
        .map(parse_return_status)
        .transpose()?;

    let repo = PgPurchaseReturnRepository::new(state.pool.clone());
    let (returns, total) = repo
        .list(
            params.purchase_order_id,
            status,
            params.limit(),
            params.offset(),
        )
        .await?;

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
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<PurchaseReturnResponse>, ApiError> {
    let repo = PgPurchaseReturnRepository::new(state.pool.clone());

    let pr = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Purchase return not found".to_string())))?;

    let items = repo.get_items(id).await?;

    let mut response = PurchaseReturnResponse::from(pr);
    response.items = Some(
        items
            .into_iter()
            .map(PurchaseReturnItemResponse::from)
            .collect(),
    );

    Ok(Json(response))
}

async fn update_purchase_return(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateReturnRequest>,
) -> Result<Json<PurchaseReturnResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let status = payload
        .status
        .as_deref()
        .map(parse_return_status)
        .transpose()?;

    let repo = PgPurchaseReturnRepository::new(state.pool.clone());

    let updated = match status {
        Some(s) => repo.update_status(id, s, payload.refund_amount).await?,
        None => {
            // No status change — find and return current
            repo.find_by_id(id)
                .await?
                .ok_or_else(|| ApiError(DomainError::NotFound("Purchase return not found".to_string())))?
        }
    };

    Ok(Json(PurchaseReturnResponse::from(updated)))
}

async fn delete_purchase_return(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgPurchaseReturnRepository::new(state.pool.clone());
    repo.delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
