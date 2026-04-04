use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::supplier::Supplier;
use vandepot_domain::ports::supplier_repository::SupplierRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::supplier_repo::PgSupplierRepository;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
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

// ── Handlers ──────────────────────────────────────────────────────────

async fn create_supplier(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateSupplierRequest>,
) -> Result<(StatusCode, Json<SupplierResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgSupplierRepository::new(state.pool.clone());
    let supplier = repo
        .create(
            &payload.name,
            payload.contact_name.as_deref(),
            payload.phone.as_deref(),
            payload.email.as_deref(),
        )
        .await?;

    Ok((StatusCode::CREATED, Json(SupplierResponse::from(supplier))))
}

async fn list_suppliers(
    State(state): State<AppState>,
    _claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<SupplierResponse>>, ApiError> {
    let repo = PgSupplierRepository::new(state.pool.clone());
    let (suppliers, total) = repo.list(params.limit(), params.offset()).await?;

    Ok(Json(PaginatedResponse {
        data: suppliers.into_iter().map(SupplierResponse::from).collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

async fn get_supplier(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<SupplierResponse>, ApiError> {
    let repo = PgSupplierRepository::new(state.pool.clone());
    let supplier = repo
        .find_by_id(id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Supplier not found".to_string())))?;

    Ok(Json(SupplierResponse::from(supplier)))
}

async fn update_supplier(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateSupplierRequest>,
) -> Result<Json<SupplierResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner", "warehouse_manager"])?;

    let repo = PgSupplierRepository::new(state.pool.clone());
    let supplier = repo
        .update(
            id,
            payload.name.as_deref(),
            payload.contact_name.as_ref().map(|c| c.as_deref()),
            payload.phone.as_ref().map(|p| p.as_deref()),
            payload.email.as_ref().map(|e| e.as_deref()),
        )
        .await?;

    Ok(Json(SupplierResponse::from(supplier)))
}

async fn delete_supplier(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgSupplierRepository::new(state.pool.clone());

    // Check for existing movements
    if repo.has_movements(id).await? {
        return Err(ApiError(DomainError::Conflict(
            "Cannot delete supplier with existing movements".to_string(),
        )));
    }

    repo.delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}
