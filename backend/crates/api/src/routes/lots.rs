use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{MovementType, QualityStatus};
use vandepot_domain::models::receive_outcome::ReceiveOutcome;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::lots_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReceiveLotRequest {
    pub product_id: Uuid,
    pub lot_number: String,
    /// Warehouse whose Recepción will receive the lot. The server resolves
    /// the Reception location internally — clients MUST NOT pick one.
    pub warehouse_id: Uuid,
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

#[derive(Deserialize)]
pub struct DistributeLotRequest {
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub notes: Option<String>,
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

/// Response shape for `POST /lots/receive`. The `kind` discriminator lets
/// clients tell the two receive outcomes apart:
///
/// * `lot` — lot-backed receive (raw_material, or consumable+has_expiry).
/// * `direct_inventory` — no-lot receive (tool_spare, or consumable without
///   expiry); the quantity still lands at Recepción but no `product_lots`
///   row is created.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReceiveResponse {
    Lot {
        lot: ProductLotResponse,
    },
    DirectInventory {
        inventory_id: Uuid,
        movement_id: Uuid,
        product_id: Uuid,
        location_id: Uuid,
        quantity: f64,
    },
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

#[derive(Deserialize)]
pub struct UpdateQualityRequest {
    pub quality_status: QualityStatus,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct TransferLotRequest {
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub notes: Option<String>,
}

#[derive(Serialize)]
pub struct MovementResponse {
    pub id: Uuid,
    pub product_id: Uuid,
    pub movement_type: MovementType,
    pub from_location_id: Option<Uuid>,
    pub from_location_name: Option<String>,
    pub to_location_id: Option<Uuid>,
    pub to_location_name: Option<String>,
    pub quantity: f64,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the B1/B2/B3
/// per-route helper convention.
fn require_tenant_for_lots(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for lot operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn lot_routes() -> Router<AppState> {
    Router::new()
        .route("/products/{product_id}/lots", get(list_lots))
        .route("/lots/{id}", get(get_lot))
        .route("/lots/{id}/inventory", get(get_lot_inventory))
        .route("/lots/{id}/quality", patch(update_quality_status))
        .route("/lots/{id}/transfer", post(transfer_lot))
        .route("/lots/{id}/distribute", post(distribute_lot))
        .route("/lots/{id}/movements", get(get_lot_movements))
        .route("/lots/receive", post(receive_lot))
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn list_lots(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<LotWithInventoryResponse>>, ApiError> {
    let tenant_id = require_tenant_for_lots(&claims)?;

        let rows = lots_repo::list_lots_by_product(&mut *tt.tx, tenant_id, product_id).await?;

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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn get_lot(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<ProductLotResponse>, ApiError> {
    let tenant_id = require_tenant_for_lots(&claims)?;

        let row = lots_repo::get_lot(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
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
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<InventoryLotResponse>>, ApiError> {
    let tenant_id = require_tenant_for_lots(&claims)?;

        let rows = lots_repo::get_lot_inventory(&mut *tt.tx, tenant_id, id).await?;

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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn update_quality_status(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateQualityRequest>,
) -> Result<Json<ProductLotResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_lots(&claims)?;

    let row = lots_repo::update_quality_status(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.quality_status,
        claims.sub,
        payload.notes.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
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

async fn transfer_lot(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<TransferLotRequest>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_lots(&claims)?;

    lots_repo::transfer_lot(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.from_location_id,
        payload.to_location_id,
        payload.quantity,
        claims.sub,
        payload.notes.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn distribute_lot(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<DistributeLotRequest>,
) -> Result<Json<Vec<InventoryLotResponse>>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_lots(&claims)?;

    lots_repo::distribute_lot(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.to_location_id,
        payload.quantity,
        claims.sub,
        payload.notes.as_deref(),
    )
    .await?;

    // Return the lot's updated per-location distribution so the client can
    // re-render without issuing a follow-up GET.
        let rows = lots_repo::get_lot_inventory(&mut *tt.tx, tenant_id, id).await?;
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn get_lot_movements(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<MovementResponse>>, ApiError> {
    let tenant_id = require_tenant_for_lots(&claims)?;

        let rows = lots_repo::get_lot_movements(&mut *tt.tx, tenant_id, id).await?;

    let data = rows
        .into_iter()
        .map(|row| MovementResponse {
            id: row.id,
            product_id: row.product_id,
            movement_type: row.movement_type,
            from_location_id: row.from_location_id,
            from_location_name: row.from_location_name,
            to_location_id: row.to_location_id,
            to_location_name: row.to_location_name,
            quantity: row.quantity,
            reference: row.reference,
            notes: row.notes,
            user_id: row.user_id,
            created_at: row.created_at,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn receive_lot(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<ReceiveLotRequest>,
) -> Result<(StatusCode, Json<ReceiveResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_lots(&claims)?;

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

    let outcome = lots_repo::receive_lot(
        &mut *tt.tx,
        tenant_id,
        payload.product_id,
        &payload.lot_number,
        payload.warehouse_id,
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

    let body = match outcome {
        ReceiveOutcome::Lot(lot) => ReceiveResponse::Lot {
            lot: ProductLotResponse {
                id: lot.id,
                product_id: lot.product_id,
                lot_number: lot.lot_number,
                batch_date: lot.batch_date,
                expiration_date: lot.expiration_date,
                supplier_id: lot.supplier_id,
                received_quantity: lot.received_quantity,
                quality_status: lot.quality_status,
                notes: lot.notes,
                purchase_order_line_id: lot.purchase_order_line_id,
                created_at: lot.created_at,
                updated_at: lot.updated_at,
            },
        },
        ReceiveOutcome::DirectInventory {
            inventory_id,
            movement_id,
            product_id,
            location_id,
            quantity,
        } => ReceiveResponse::DirectInventory {
            inventory_id,
            movement_id,
            product_id,
            location_id,
            quantity,
        },
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(body)))
}
