use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::models::enums::UserRole;
use vandepot_domain::models::user::User;
use vandepot_domain::ports::user_repository::UserRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::password::hash_password;
use vandepot_infra::repositories::user_repo::PgUserRepository;

use crate::error::ApiError;
use crate::extractors::role_guard::require_role;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    #[serde(default = "default_role")]
    pub role: String,
}

fn default_role() -> String {
    "operator".to_string()
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub password: String,
}

#[derive(Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: UserRole,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            is_active: u.is_active,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct WarehouseAssignmentResponse {
    pub warehouse_ids: Vec<Uuid>,
}

// ── Routes ────────────────────────────────────────────────────────────

pub fn user_routes() -> Router<AppState> {
    Router::new()
        .route("/users", post(create_user).get(list_users))
        .route(
            "/users/{id}",
            get(get_user).put(update_user).delete(delete_user),
        )
        .route("/users/{id}/password", put(change_password))
        .route(
            "/users/{user_id}/warehouses",
            get(list_user_warehouses),
        )
        .route(
            "/users/{user_id}/warehouses/{warehouse_id}",
            post(assign_warehouse).delete(revoke_warehouse),
        )
}

// ── Handlers ──────────────────────────────────────────────────────────

/// POST /users — Create a new user (superadmin, owner).
async fn create_user(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    // Validate role string
    let role: UserRole = serde_json::from_str(&format!("\"{}\"", payload.role))
        .map_err(|_| {
            ApiError(vandepot_domain::error::DomainError::Validation(format!(
                "Invalid role: {}",
                payload.role
            )))
        })?;

    // Hash the password
    let password_hash = hash_password(&payload.password).map_err(|e| {
        ApiError(vandepot_domain::error::DomainError::Internal(
            e.to_string(),
        ))
    })?;

    let user = User {
        id: Uuid::new_v4(),
        email: payload.email,
        password_hash,
        name: payload.name,
        role,
        is_active: true,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        deleted_at: None,
    };

    let repo = PgUserRepository::new(state.pool.clone());
    let created = repo.create(&user).await?;

    Ok((StatusCode::CREATED, Json(UserResponse::from(created))))
}

/// GET /users — List users with pagination.
/// Superadmin sees all; owner sees users in their warehouses.
async fn list_users(
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<UserResponse>>, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgUserRepository::new(state.pool.clone());

    let (users, total) = if claims.role.eq_ignore_ascii_case("superadmin") {
        repo.list(params.limit(), params.offset()).await?
    } else {
        // Owner: only users in their warehouses
        repo.list_by_warehouses(&claims.warehouse_ids, params.limit(), params.offset())
            .await?
    };

    Ok(Json(PaginatedResponse {
        data: users.into_iter().map(UserResponse::from).collect(),
        total,
        page: params.page(),
        per_page: params.limit(),
    }))
}

/// GET /users/:id — Get user details.
async fn get_user(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<UserResponse>, ApiError> {
    // Any authenticated user can view a user's details.
    // Non-superadmin/owner can only view themselves.
    let is_admin = claims.role.eq_ignore_ascii_case("superadmin")
        || claims.role.eq_ignore_ascii_case("owner");

    if !is_admin && claims.sub != id {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        )));
    }

    let repo = PgUserRepository::new(state.pool.clone());
    let user = repo.find_by_id(id).await?.ok_or_else(|| {
        ApiError(vandepot_domain::error::DomainError::NotFound(
            "User not found".to_string(),
        ))
    })?;

    Ok(Json(UserResponse::from(user)))
}

/// PUT /users/:id — Update user (name, role, is_active).
/// Superadmin can change any field. Owner can only change name for users in their warehouses.
async fn update_user(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let is_superadmin = claims.role.eq_ignore_ascii_case("superadmin");

    // Owner cannot change role or is_active
    if !is_superadmin && (payload.role.is_some() || payload.is_active.is_some()) {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Only superadmin can change role or active status".to_string(),
        )));
    }

    // Parse role string into UserRole if provided
    let role_enum: Option<UserRole> = if is_superadmin {
        match &payload.role {
            Some(r) => {
                let parsed: UserRole = serde_json::from_str(&format!("\"{}\"", r))
                    .map_err(|_| {
                        ApiError(vandepot_domain::error::DomainError::Validation(format!(
                            "Invalid role: {}",
                            r
                        )))
                    })?;
                Some(parsed)
            }
            None => None,
        }
    } else {
        None
    };

    let repo = PgUserRepository::new(state.pool.clone());
    let user = repo
        .update(
            id,
            payload.name.as_deref(),
            role_enum.as_ref(),
            if is_superadmin { payload.is_active } else { None },
        )
        .await?;

    Ok(Json(UserResponse::from(user)))
}

/// DELETE /users/:id — Soft delete (superadmin only). Cannot delete yourself.
async fn delete_user(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin"])?;

    if claims.sub == id {
        return Err(ApiError(vandepot_domain::error::DomainError::Validation(
            "Cannot delete yourself".to_string(),
        )));
    }

    let repo = PgUserRepository::new(state.pool.clone());
    repo.soft_delete(id).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// PUT /users/:id/password — Change password (superadmin or self).
async fn change_password(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let is_superadmin = claims.role.eq_ignore_ascii_case("superadmin");
    let is_self = claims.sub == id;

    if !is_superadmin && !is_self {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        )));
    }

    let password_hash = hash_password(&payload.password).map_err(|e| {
        ApiError(vandepot_domain::error::DomainError::Internal(
            e.to_string(),
        ))
    })?;

    let repo = PgUserRepository::new(state.pool.clone());
    repo.change_password(id, &password_hash).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /users/:user_id/warehouses/:warehouse_id — Assign user to warehouse.
async fn assign_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Path((user_id, warehouse_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgUserRepository::new(state.pool.clone());
    repo.assign_warehouse(user_id, warehouse_id).await?;

    Ok(StatusCode::CREATED)
}

/// DELETE /users/:user_id/warehouses/:warehouse_id — Revoke warehouse access.
async fn revoke_warehouse(
    State(state): State<AppState>,
    claims: Claims,
    Path((user_id, warehouse_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_role(&claims, &["superadmin", "owner"])?;

    let repo = PgUserRepository::new(state.pool.clone());
    repo.revoke_warehouse(user_id, warehouse_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /users/:user_id/warehouses — List warehouses assigned to a user.
async fn list_user_warehouses(
    State(state): State<AppState>,
    claims: Claims,
    Path(user_id): Path<Uuid>,
) -> Result<Json<WarehouseAssignmentResponse>, ApiError> {
    // Superadmin/owner can list any user's warehouses; others can only see their own
    let is_admin = claims.role.eq_ignore_ascii_case("superadmin")
        || claims.role.eq_ignore_ascii_case("owner");

    if !is_admin && claims.sub != user_id {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        )));
    }

    let repo = PgUserRepository::new(state.pool.clone());
    let warehouse_ids = repo.list_user_warehouses(user_id).await?;

    Ok(Json(WarehouseAssignmentResponse { warehouse_ids }))
}
