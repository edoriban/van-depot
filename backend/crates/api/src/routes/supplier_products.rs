use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::supplier_products_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateSupplierProductRequest {
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: Option<i32>,
    pub minimum_order_qty: Option<f64>,
    pub is_preferred: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateSupplierProductRequest {
    pub supplier_sku: Option<Option<String>>,
    pub unit_cost: Option<f64>,
    pub lead_time_days: Option<i32>,
    pub minimum_order_qty: Option<f64>,
    pub is_preferred: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Serialize)]
pub struct SupplierProductResponse {
    pub id: Uuid,
    pub supplier_id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct SupplierProductWithSupplierResponse {
    pub id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_name: String,
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn supplier_product_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/suppliers/{supplier_id}/products",
            get(list_by_supplier).post(create),
        )
        .route("/products/{product_id}/suppliers", get(list_by_product))
        .route(
            "/supplier-products/{id}",
            put(update).delete(delete),
        )
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// for superadmin tokens that haven't selected a tenant. Mirrors the B2
/// per-route helper convention.
fn require_tenant_for_supplier_products(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for supplier-product operations \
             (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(supplier_id): Path<Uuid>,
    Json(payload): Json<CreateSupplierProductRequest>,
) -> Result<(StatusCode, Json<SupplierProductResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_supplier_products(&claims)?;

        // Cross-tenant supplier_id or product_id surfaces as a 23503 FK
    // violation on `supplier_products_supplier_tenant_fk` /
    // `supplier_products_product_tenant_fk` (composite). map_sqlx_error
    // converts it to 409 Conflict — the body trusts the caller's
    // path/body, but the composite FK guarantees both refs match the
    // active tenant.
    let row = supplier_products_repo::create_supplier_product(
        &mut *tt.tx,
        tenant_id,
        supplier_id,
        payload.product_id,
        payload.supplier_sku.as_deref(),
        payload.unit_cost,
        payload.lead_time_days.unwrap_or(0),
        payload.minimum_order_qty.unwrap_or(1.0),
        payload.is_preferred.unwrap_or(false),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((
        StatusCode::CREATED,
        Json(SupplierProductResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }),
    ))
}

async fn list_by_supplier(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(supplier_id): Path<Uuid>,
) -> Result<Json<Vec<SupplierProductResponse>>, ApiError> {
    let tenant_id = require_tenant_for_supplier_products(&claims)?;

        let rows =
        supplier_products_repo::list_by_supplier(&mut *tt.tx, tenant_id, supplier_id).await?;

    let data = rows
        .into_iter()
        .map(|row| SupplierProductResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            product_id: row.product_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn list_by_product(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(product_id): Path<Uuid>,
) -> Result<Json<Vec<SupplierProductWithSupplierResponse>>, ApiError> {
    let tenant_id = require_tenant_for_supplier_products(&claims)?;

        let rows =
        supplier_products_repo::list_by_product(&mut *tt.tx, tenant_id, product_id).await?;

    let data = rows
        .into_iter()
        .map(|row| SupplierProductWithSupplierResponse {
            id: row.id,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
            product_id: row.product_id,
            supplier_sku: row.supplier_sku,
            unit_cost: row.unit_cost,
            lead_time_days: row.lead_time_days,
            minimum_order_qty: row.minimum_order_qty,
            is_preferred: row.is_preferred,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(data))
}

async fn update(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateSupplierProductRequest>,
) -> Result<Json<SupplierProductResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_supplier_products(&claims)?;

        let row = supplier_products_repo::update_supplier_product(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.supplier_sku.as_ref().map(|s| s.as_deref()),
        payload.unit_cost,
        payload.lead_time_days,
        payload.minimum_order_qty,
        payload.is_preferred,
        payload.is_active,
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(SupplierProductResponse {
        id: row.id,
        supplier_id: row.supplier_id,
        product_id: row.product_id,
        product_name: row.product_name,
        product_sku: row.product_sku,
        supplier_sku: row.supplier_sku,
        unit_cost: row.unit_cost,
        lead_time_days: row.lead_time_days,
        minimum_order_qty: row.minimum_order_qty,
        is_preferred: row.is_preferred,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn delete(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_supplier_products(&claims)?;

        supplier_products_repo::delete_supplier_product(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
