use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::QualityStatus;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::lots_repo;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReceiveLotRequest {
    pub product_id: Uuid,
    pub lot_number: String,
    pub location_id: Uuid,
    pub good_quantity: f64,
    pub defect_quantity: Option<f64>,
    pub supplier_id: Option<Uuid>,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub notes: Option<String>,
    // Optional PO linking fields (backward-compatible)
    pub purchase_order_line_id: Option<Uuid>,
    pub purchase_order_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct ProductLotResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub lot_number: String,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub supplier_id: Option<Uuid>,
    pub received_quantity: f64,
    pub quality_status: QualityStatus,
    pub notes: Option<String>,
    pub purchase_order_line_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LotWithInventoryResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub lot_number: String,
    pub batch_date: Option<NaiveDate>,
    pub expiration_date: Option<NaiveDate>,
    pub supplier_id: Option<Uuid>,
    pub received_quantity: f64,
    pub quality_status: QualityStatus,
    pub notes: Option<String>,
    pub total_quantity: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct InventoryLotResponse {
    pub id: Uuid,
    pub product_lot_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub quantity: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn lot_routes() -> Router<AppState> {
    Router::new()
        .route("/products/{product_id}/lots", get(list_lots))
        .route("/lots/{id}", get(get_lot))
        .route("/lots/{id}/inventory", get(get_lot_inventory))
        .route("/lots/receive", post(receive_lot))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn list_lots(
    State(state): State<AppState>,
    _claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<LotWithInventoryResponse>>, ApiError> {
    let rows = lots_repo::list_lots_by_product(&state.pool, product_id).await?;

    let data = rows
        .into_iter()
        .map(|row| LotWithInventoryResponse {
            id: row.id,
            product_id: row.product_id,
            lot_number: row.lot_number,
            batch_date: row.batch_date,
            expiration_date: row.expiration_date,
            supplier_id: row.supplier_id,
            received_quantity: row.received_quantity,
            quality_status: row.quality_status,
            notes: row.notes,
            total_quantity: row.total_quantity,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    Ok(Json(data))
}

async fn get_lot(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<ProductLotResponse>, ApiError> {
    let row = lots_repo::get_lot(&state.pool, id).await?;

    Ok(Json(ProductLotResponse {
        id: row.id,
        product_id: row.product_id,
        lot_number: row.lot_number,
        batch_date: row.batch_date,
        expiration_date: row.expiration_date,
        supplier_id: row.supplier_id,
        received_quantity: row.received_quantity,
        quality_status: row.quality_status,
        notes: row.notes,
        purchase_order_line_id: row.purchase_order_line_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn get_lot_inventory(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<InventoryLotResponse>>, ApiError> {
    let rows = lots_repo::get_lot_inventory(&state.pool, id).await?;

    let data = rows
        .into_iter()
        .map(|row| InventoryLotResponse {
            id: row.id,
            product_lot_id: row.product_lot_id,
            location_id: row.location_id,
            location_name: row.location_name,
            quantity: row.quantity,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    Ok(Json(data))
}

async fn receive_lot(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<ReceiveLotRequest>,
) -> Result<(StatusCode, Json<ProductLotResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    if payload.good_quantity < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Good quantity must be >= 0".to_string(),
        )));
    }

    let defect_qty = payload.defect_quantity.unwrap_or(0.0);
    if defect_qty < 0.0 {
        return Err(ApiError(DomainError::Validation(
            "Defect quantity must be >= 0".to_string(),
        )));
    }

    if payload.good_quantity == 0.0 && defect_qty == 0.0 {
        return Err(ApiError(DomainError::Validation(
            "At least one quantity must be greater than 0".to_string(),
        )));
    }

    let row = lots_repo::receive_lot(
        &state.pool,
        payload.product_id,
        &payload.lot_number,
        payload.location_id,
        payload.good_quantity,
        defect_qty,
        payload.supplier_id,
        payload.batch_date,
        payload.expiration_date,
        claims.sub,
        payload.notes.as_deref(),
        payload.purchase_order_line_id,
        payload.purchase_order_id,
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ProductLotResponse {
            id: row.id,
            product_id: row.product_id,
            lot_number: row.lot_number,
            batch_date: row.batch_date,
            expiration_date: row.expiration_date,
            supplier_id: row.supplier_id,
            received_quantity: row.received_quantity,
            quality_status: row.quality_status,
            notes: row.notes,
            purchase_order_line_id: row.purchase_order_line_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }),
    ))
}
