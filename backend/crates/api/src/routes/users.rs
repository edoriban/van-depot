use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::user::User;
use vandepot_domain::ports::user_repository::UserRepository;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::password::hash_password;
use vandepot_infra::repositories::user_repo::PgUserRepository;
use vandepot_infra::repositories::user_warehouse_repo;
use argon2::password_hash::rand_core::{OsRng, RngCore};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::extractors::role_guard::require_role_claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::state::AppState;

/// Resolves the active tenant_id from the caller's claims, or returns 422 for
/// non-superadmin tokens that haven't selected a tenant. Mirrors the B1..B7
/// per-route helper convention.
fn require_tenant_for_users(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for user-warehouse operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

// ── DTOs ──────────────────────────────────────────────────────────────

/// A3: `role` was removed from the create payload. New users have no global
/// role; tenant-scoped role assignment lives on `user_tenants` and is granted
/// via the membership endpoints (A11). `/users` no longer participates in
/// role assignment.
#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: Option<String>,
    pub name: String,
}

fn generate_invite_code() -> String {
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|&b| ALPHABET[(b as usize) % ALPHABET.len()] as char).collect()
}

/// A3: `role` was removed; tenant-role updates flow through `user_tenants`
/// (A11 membership endpoints), not `/users/{id}`.
#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub password: String,
}

/// A3: `role` was removed. `is_superadmin` is included so the admin UI can
/// distinguish the bypass identity from regular users; tenant-scoped role
/// information comes from membership endpoints.
#[derive(Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub is_superadmin: bool,
    pub is_active: bool,
    pub must_set_password: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            is_superadmin: u.is_superadmin,
            is_active: u.is_active,
            must_set_password: u.must_set_password,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct CreateUserResponse {
    #[serde(flatten)]
    pub user: UserResponse,
    pub invite_code: Option<String>,
    pub invite_expires_at: Option<DateTime<Utc>>,
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
/// If `password` is absent or empty, an invite code is generated instead.
///
/// A3: this endpoint no longer accepts a `role` field. New users are created
/// without any tenant membership; an admin grants a per-tenant role through
/// the `/admin/tenants/{id}/memberships` endpoints.
async fn create_user(
    State(state): State<AppState>,
    Tenant(tt): Tenant,
    claims: Claims,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<CreateUserResponse>), ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;

    let use_invite = payload.password.as_deref().unwrap_or("").is_empty();

    let (password_hash, invite_code_hash, plaintext_invite, invite_expires_at, must_set_password) =
        if use_invite {
            let code = generate_invite_code();
            let code_hash = hash_password(&code).map_err(|e| {
                ApiError(vandepot_domain::error::DomainError::Internal(e.to_string()))
            })?;
            let expires = chrono::Utc::now() + chrono::Duration::days(7);
            (
                "INVITE_PENDING".to_string(),
                Some(code_hash),
                Some(code),
                Some(expires),
                true,
            )
        } else {
            let hash = hash_password(payload.password.as_deref().unwrap()).map_err(|e| {
                ApiError(vandepot_domain::error::DomainError::Internal(e.to_string()))
            })?;
            (hash, None, None, None, false)
        };

    let user = User {
        id: Uuid::new_v4(),
        email: payload.email,
        password_hash,
        name: payload.name,
        // is_superadmin is bootstrapped via env-gated seed (A15) — never set
        // by an authenticated user-creation flow.
        is_superadmin: false,
        is_active: true,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        deleted_at: None,
        invite_code_hash,
        invite_expires_at,
        must_set_password,
    };

    let repo = PgUserRepository::new(state.pool.clone());
    let created = repo.create(&user).await?;

    // Admins grant tenant membership via the
    // `/admin/tenants/{id}/memberships` endpoint. `/users` intentionally does
    // NOT couple membership assignment with user creation.

    let response = CreateUserResponse {
        invite_code: plaintext_invite,
        invite_expires_at: created.invite_expires_at,
        user: UserResponse::from(created),
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /users — List users with pagination.
/// Superadmin sees all; owner sees users in their warehouses.
async fn list_users(
    State(state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<UserResponse>>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;

    let repo = PgUserRepository::new(state.pool.clone());

    let (users, total) = if claims.is_superadmin {
        repo.list(params.limit(), params.offset()).await?
    } else {
        // Owner: only users in their warehouses. Tenant-scoped lookup via
        // `user_warehouse_repo::list_for_user` (B8.4).
        let tenant_id = require_tenant_for_users(&claims)?;
                let warehouse_ids =
            user_warehouse_repo::list_for_user(&mut *tt.tx, tenant_id, claims.sub).await?;
        repo.list_by_warehouses(&warehouse_ids, params.limit(), params.offset())
            .await?
    };

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
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
    Tenant(tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<UserResponse>, ApiError> {
    // Any authenticated user can view a user's details.
    // Non-superadmin/owner can only view themselves.
    let is_admin = claims.is_superadmin
        || matches!(claims.role, Some(TenantRole::Owner));

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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(UserResponse::from(user)))
}

/// PUT /users/:id — Update user (name, is_active).
/// Superadmin can change any field. Owner can only change name.
///
/// A3: `role` is no longer a user-aggregate field. Tenant-role changes flow
/// through the `/admin/tenants/{id}/memberships` endpoints.
async fn update_user(
    State(state): State<AppState>,
    Tenant(tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;

    let is_superadmin = claims.is_superadmin;

    // Owner cannot change is_active.
    if !is_superadmin && payload.is_active.is_some() {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Only superadmin can change active status".to_string(),
        )));
    }

    let repo = PgUserRepository::new(state.pool.clone());
    let user = repo
        .update(
            id,
            payload.name.as_deref(),
            if is_superadmin { payload.is_active } else { None },
        )
        .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(UserResponse::from(user)))
}

/// DELETE /users/:id — Soft delete (superadmin only). Cannot delete yourself.
async fn delete_user(
    State(state): State<AppState>,
    Tenant(tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[])?;

    if claims.sub == id {
        return Err(ApiError(vandepot_domain::error::DomainError::Validation(
            "Cannot delete yourself".to_string(),
        )));
    }

    let repo = PgUserRepository::new(state.pool.clone());
    repo.soft_delete(id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /users/:id/password — Change password (superadmin or self).
async fn change_password(
    State(state): State<AppState>,
    Tenant(tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let is_superadmin = claims.is_superadmin;
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

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /users/:user_id/warehouses/:warehouse_id — Assign user to warehouse.
///
/// B8.4: assignment now requires an active tenant. The DB-level composite
/// FK on `user_warehouses(tenant_id, user_id) -> user_tenants(tenant_id,
/// user_id)` guarantees the target user is also a member of the active
/// tenant; otherwise the INSERT fails with 23503 and the repo maps it to
/// `DomainError::Validation` (422).
async fn assign_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path((user_id, warehouse_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_users(&claims)?;

        user_warehouse_repo::assign(&mut *tt.tx, tenant_id, user_id, warehouse_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::CREATED)
}

/// DELETE /users/:user_id/warehouses/:warehouse_id — Revoke warehouse access.
async fn revoke_warehouse(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path((user_id, warehouse_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_role_claims(&claims, &[TenantRole::Owner])?;
    let tenant_id = require_tenant_for_users(&claims)?;

        user_warehouse_repo::revoke(&mut *tt.tx, tenant_id, user_id, warehouse_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /users/:user_id/warehouses — List warehouses assigned to a user.
async fn list_user_warehouses(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(user_id): Path<Uuid>,
) -> Result<Json<WarehouseAssignmentResponse>, ApiError> {
    // Superadmin/owner can list any user's warehouses; others can only see their own
    let is_admin = claims.is_superadmin
        || matches!(claims.role, Some(TenantRole::Owner));

    if !is_admin && claims.sub != user_id {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        )));
    }

    let tenant_id = require_tenant_for_users(&claims)?;
        let warehouse_ids =
        user_warehouse_repo::list_for_user(&mut *tt.tx, tenant_id, user_id).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(WarehouseAssignmentResponse { warehouse_ids }))
}
