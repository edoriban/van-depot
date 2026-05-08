use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::supplier::Supplier;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::supplier_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateSupplierRequest {
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateSupplierRequest {
    pub name: Option<String>,
    pub contact_name: Option<Option<String>>,
    pub phone: Option<Option<String>>,
    pub email: Option<Option<String>>,
}

#[derive(Serialize)]
pub struct SupplierResponse {
    pub id: Uuid,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Supplier> for SupplierResponse {
    fn from(s: Supplier) -> Self {
        Self {
            id: s.id,
            name: s.name,
            contact_name: s.contact_name,
            phone: s.phone,
            email: s.email,
            is_active: s.is_active,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn supplier_routes() -> Router<AppState> {
    Router::new()
        .route("/suppliers", post(create_supplier).get(list_suppliers))
        .route(
            "/suppliers/{id}",
            get(get_supplier)
                .put(update_supplier)
                .delete(delete_supplier),
        )
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns 422
/// with a clear message for superadmin tokens that haven't selected a
/// tenant. Mirrors `require_tenant_for_products` (B2 template).
fn require_tenant_for_suppliers(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for supplier operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_supplier(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateSupplierRequest>,
) -> Result<(StatusCode, Json<SupplierResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_suppliers(&claims)?;

        let supplier = supplier_repo::create(
        &mut *tt.tx,
        tenant_id,
        &payload.name,
        payload.contact_name.as_deref(),
        payload.phone.as_deref(),
        payload.email.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(SupplierResponse::from(supplier))))
}

async fn list_suppliers(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<SupplierResponse>>, ApiError> {
    let tenant_id = require_tenant_for_suppliers(&claims)?;

        let (suppliers, total) =
        supplier_repo::list(&mut *tt.tx, tenant_id, params.limit(), params.offset()).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedResponse {
        data: suppliers.into_iter().map(SupplierResponse::from).collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_supplier(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<SupplierResponse>, ApiError> {
    let tenant_id = require_tenant_for_suppliers(&claims)?;

        let supplier = supplier_repo::find_by_id(&mut *tt.tx, tenant_id, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Supplier not found".to_string())))?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(SupplierResponse::from(supplier)))
}

async fn update_supplier(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateSupplierRequest>,
) -> Result<Json<SupplierResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner, TenantRole::Manager])?;
    let tenant_id = require_tenant_for_suppliers(&claims)?;

        let supplier = supplier_repo::update(
        &mut *tt.tx,
        tenant_id,
        id,
        payload.name.as_deref(),
        payload.contact_name.as_ref().map(|c| c.as_deref()),
        payload.phone.as_ref().map(|p| p.as_deref()),
        payload.email.as_ref().map(|e| e.as_deref()),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(SupplierResponse::from(supplier)))
}

async fn delete_supplier(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_suppliers(&claims)?;

        // Tenant-scoped existence + movement-blocker preflight. `has_movements`
    // returns NotFound for cross-tenant ids and a true/false otherwise. We
    // map true → 409.
    if supplier_repo::has_movements(&mut *tt.tx, tenant_id, id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete supplier with existing movements".to_string(),
        )));
    }

    supplier_repo::delete(&mut *tt.tx, tenant_id, id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}
