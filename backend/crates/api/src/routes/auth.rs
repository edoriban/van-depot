//! Authentication routes — implements the two-step login flow described in
//! `sdd/multi-tenant-foundation/design` §6 (A12/A13/A14).
//!
//! Flow summary:
//! - `POST /auth/login` (A12): authenticate by email+password and either
//!   1. mint a final access/refresh pair (superadmin OR exactly one active
//!      membership), or
//!   2. mint a short-lived `Intermediate` token plus a `memberships` list when
//!      the user belongs to >1 tenants. The frontend then exchanges the
//!      intermediate via `POST /auth/select-tenant`.
//!   Zero memberships on a non-superadmin returns 403.
//!
//! - `POST /auth/select-tenant` (A13): consumes a `Intermediate` token and a
//!   chosen `tenant_id`, re-verifies membership via `verify_membership`
//!   (which checks tenant `status = 'active' AND deleted_at IS NULL`), and
//!   mints a final access/refresh pair scoped to the chosen tenant.
//!
//! - `POST /auth/refresh` (A14): consumes a `Refresh` token and re-issues a
//!   new pair, re-verifying membership for non-superadmins so role changes
//!   and revocations propagate without forcing logout.

use axum::http::StatusCode;
use axum::{extract::State, routing::post, Json, Router};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use vandepot_domain::error::DomainError;
use vandepot_domain::ports::user_repository::UserRepository;
use vandepot_infra::auth::jwt::{
    create_access_token, create_intermediate_token, create_refresh_token, validate_token, Claims,
    TokenKind,
};
use vandepot_infra::auth::password::{hash_password, verify_password};
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::user_repo::PgUserRepository;
use vandepot_infra::repositories::user_tenant_repo::{self, Membership};

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct SelectTenantRequest {
    pub tenant_id: Uuid,
}

#[derive(Deserialize)]
pub struct ActivateRequest {
    pub email: String,
    pub code: String,
    pub new_password: String,
}

/// Subset of the user record exposed in auth responses. Mirrors the existing
/// public contract; callers should not rely on hashes/timestamps appearing.
#[derive(Serialize)]
pub struct UserDto {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub is_superadmin: bool,
}

/// Tenant identity surfaced inside a `Final` token response. `None` means the
/// session is superadmin-scoped (no active tenant).
#[derive(Serialize)]
pub struct TenantDto {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

/// Membership entry surfaced in the multi-tenant login response so the
/// frontend can render the tenant picker without a second round-trip.
#[derive(Serialize)]
pub struct MembershipDto {
    pub tenant_id: Uuid,
    pub tenant_slug: String,
    pub tenant_name: String,
    pub role: TenantRole,
}

/// Response shape for `/auth/login` and `/auth/select-tenant`.
///
/// `#[serde(untagged)]` is used because the discriminator is naturally the
/// presence/absence of `access_token` vs `intermediate_token`. The frontend
/// (A17) branches on `response.access_token != null`.
#[derive(Serialize)]
#[serde(untagged)]
pub enum LoginResponse {
    /// A finished session: tenant resolved (or superadmin), full token pair
    /// minted. `tenant`/`role` are `None` for superadmins.
    Final {
        access_token: String,
        refresh_token: String,
        user: UserDto,
        tenant: Option<TenantDto>,
        role: Option<TenantRole>,
        is_superadmin: bool,
    },
    /// User has multiple active memberships and must pick one. The
    /// `intermediate_token` (60s TTL) is exchanged at `/auth/select-tenant`.
    MultiTenant {
        intermediate_token: String,
        memberships: Vec<MembershipDto>,
    },
}

/// Plain `{access_token, refresh_token}` shape used by `/auth/refresh`. We
/// keep this distinct from `LoginResponse::Final` because refresh does not
/// re-emit the user/tenant payload — only fresh tokens.
#[derive(Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
}

pub fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/select-tenant", post(select_tenant))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/activate", post(activate_invite))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Stores a refresh token under the per-user key so subsequent `/auth/refresh`
/// calls can validate it. Errors map to `Internal` because Redis is
/// considered infrastructure: a failure here is server-side, not user-facing.
async fn store_refresh_token(
    state: &AppState,
    user_id: Uuid,
    token: &str,
) -> Result<(), ApiError> {
    let redis_key = format!("refresh:{}", user_id);
    let expiration = state.jwt_config.refresh_expiration as u64;
    let mut conn = state.redis.clone();
    conn.set_ex::<_, _, ()>(&redis_key, token, expiration)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(())
}

/// Mints an access+refresh pair AND persists the refresh token in Redis.
/// Centralized so login, select-tenant, refresh, and activate all use
/// identical token shapes and Redis bookkeeping.
async fn mint_token_pair(
    state: &AppState,
    user_id: Uuid,
    email: &str,
    tenant_id: Option<Uuid>,
    is_superadmin: bool,
    role: Option<TenantRole>,
) -> Result<(String, String), ApiError> {
    let access_token = create_access_token(
        &state.jwt_config,
        user_id,
        email,
        tenant_id,
        is_superadmin,
        role,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let refresh_token = create_refresh_token(
        &state.jwt_config,
        user_id,
        email,
        tenant_id,
        is_superadmin,
        role,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    store_refresh_token(state, user_id, &refresh_token).await?;
    Ok((access_token, refresh_token))
}

/// Builds a `LoginResponse::Final` for a tenant-scoped session. `tenant_dto`
/// is `Some` for tenant-bound sessions and `None` for superadmin sessions.
fn build_final_response(
    user: &vandepot_domain::models::user::User,
    access_token: String,
    refresh_token: String,
    tenant_dto: Option<TenantDto>,
    role: Option<TenantRole>,
) -> LoginResponse {
    LoginResponse::Final {
        access_token,
        refresh_token,
        user: UserDto {
            id: user.id,
            email: user.email.clone(),
            name: user.name.clone(),
            is_superadmin: user.is_superadmin,
        },
        tenant: tenant_dto,
        role,
        is_superadmin: user.is_superadmin,
    }
}

fn membership_to_dto(m: &Membership) -> MembershipDto {
    // `list_for_user` always populates the joined tenant fields, so the
    // unwrap_or fallback is defensive only — should never fire in practice.
    MembershipDto {
        tenant_id: m.tenant_id,
        tenant_slug: m.tenant_slug.clone().unwrap_or_default(),
        tenant_name: m.tenant_name.clone().unwrap_or_default(),
        role: m.role,
    }
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// `POST /auth/login` — A12 two-step login.
///
/// Branches:
/// - bad creds / inactive / pending invite → 401/403,
/// - superadmin → `Final` (tenant=None, role=None, is_superadmin=true),
/// - 0 active memberships (non-superadmin) → 403 `no_tenant_access`,
/// - exactly 1 active membership → `Final` bound to that tenant+role,
/// - >1 active memberships → `MultiTenant` with intermediate token.
async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let repo = PgUserRepository::new(state.pool.clone());

    // 1. Find user by email.
    let user = repo
        .find_by_email(&payload.email)
        .await?
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid credentials".to_string())))?;

    // 2. Pending-invite users have a placeholder hash that isn't valid Argon2,
    //    so we short-circuit BEFORE verify_password.
    if user.must_set_password {
        return Err(ApiError(DomainError::Forbidden(
            "Account not yet activated. Use your invitation code to set a password.".to_string(),
        )));
    }

    // 3. Verify password (constant-time inside argon2).
    let valid = verify_password(&payload.password, &user.password_hash)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    if !valid {
        return Err(ApiError(DomainError::AuthError(
            "Invalid credentials".to_string(),
        )));
    }

    // 4. Account must be active.
    if !user.is_active {
        return Err(ApiError(DomainError::AuthError(
            "Account is deactivated".to_string(),
        )));
    }

    // 5. Superadmin path: skip membership lookup entirely. Even if a
    //    superadmin has memberships (forbidden by spec but possible in dev
    //    DBs), they always receive a superadmin token with no tenant/role.
    if user.is_superadmin {
        let (access_token, refresh_token) =
            mint_token_pair(&state, user.id, &user.email, None, true, None).await?;
        return Ok(Json(build_final_response(
            &user,
            access_token,
            refresh_token,
            None,
            None,
        )));
    }

    // 6. Non-superadmin: list active memberships (joins tenants — soft-deleted
    //    tenants are excluded by the repo).
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    let memberships = user_tenant_repo::list_for_user(&mut conn, user.id).await?;
    drop(conn);

    match memberships.as_slice() {
        // Zero memberships — user has no tenant access.
        [] => Err(ApiError(DomainError::Forbidden(
            "no_tenant_access".to_string(),
        ))),

        // Exactly one membership — auto-select; mint a final pair.
        [single] => {
            let tenant_dto = TenantDto {
                id: single.tenant_id,
                slug: single.tenant_slug.clone().unwrap_or_default(),
                name: single.tenant_name.clone().unwrap_or_default(),
            };
            let (access_token, refresh_token) = mint_token_pair(
                &state,
                user.id,
                &user.email,
                Some(single.tenant_id),
                false,
                Some(single.role),
            )
            .await?;
            Ok(Json(build_final_response(
                &user,
                access_token,
                refresh_token,
                Some(tenant_dto),
                Some(single.role),
            )))
        }

        // >1 memberships — issue an intermediate token and let the frontend
        // call /auth/select-tenant.
        many => {
            let intermediate_token =
                create_intermediate_token(&state.jwt_config, user.id, &user.email)
                    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
            let dtos = many.iter().map(membership_to_dto).collect();
            Ok(Json(LoginResponse::MultiTenant {
                intermediate_token,
                memberships: dtos,
            }))
        }
    }
}

/// `POST /auth/select-tenant` — A13.
///
/// Consumes an `Intermediate` Bearer token and a chosen `tenant_id`. On
/// success returns a `Final` LoginResponse with a tenant-scoped access+refresh
/// pair. The decoded `Claims` extractor enforces signature + expiry; we then
/// enforce `token_kind == Intermediate` and re-verify membership against the
/// DB so a tenant suspended between login and selection is rejected.
async fn select_tenant(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<SelectTenantRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    // 1. Token-kind gate. The `Claims` extractor only validates signature and
    //    `exp`; route-specific kind enforcement happens here.
    if claims.token_kind != TokenKind::Intermediate {
        return Err(ApiError(DomainError::AuthError(
            "intermediate token required".to_string(),
        )));
    }

    // 2. Re-verify membership: must exist, be active, and the tenant must be
    //    `active` AND not soft-deleted. `verify_membership` returns the
    //    current role so we mint with the freshest value.
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let role = user_tenant_repo::verify_membership(&mut conn, claims.sub, payload.tenant_id)
        .await?
        .ok_or_else(|| {
            ApiError(DomainError::Forbidden(
                "membership_not_found_or_inactive".to_string(),
            ))
        })?;

    // 3. Fetch tenant identity for the response payload (slug/name). The
    //    membership exists per #2 so this should always succeed; soft-deleted
    //    is already filtered above.
    let tenant = vandepot_infra::repositories::tenant_repo::get_by_id(&mut conn, payload.tenant_id)
        .await?
        .ok_or_else(|| {
            ApiError(DomainError::Forbidden(
                "membership_not_found_or_inactive".to_string(),
            ))
        })?;

    // 4. Fetch user record (for the embedded UserDto). Drop the borrowed
    //    conn first so PgUserRepository can use the pool independently.
    drop(conn);
    let repo = PgUserRepository::new(state.pool.clone());
    let user = repo
        .find_by_id(claims.sub)
        .await?
        .ok_or_else(|| ApiError(DomainError::AuthError("User not found".to_string())))?;
    if !user.is_active {
        return Err(ApiError(DomainError::AuthError(
            "Account is deactivated".to_string(),
        )));
    }

    // 5. Mint the final pair scoped to the chosen tenant.
    let (access_token, refresh_token) = mint_token_pair(
        &state,
        user.id,
        &user.email,
        Some(tenant.id),
        false,
        Some(role),
    )
    .await?;

    Ok(Json(build_final_response(
        &user,
        access_token,
        refresh_token,
        Some(TenantDto {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
        }),
        Some(role),
    )))
}

/// `POST /auth/refresh` — A14.
///
/// Validates the refresh token (signature, expiry, kind), confirms it is the
/// current refresh token in Redis, and re-mints. For non-superadmins we
/// re-verify membership so role updates propagate and revoked users are
/// kicked out without waiting for token expiry.
async fn refresh(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    // 1. Decode + validate signature/exp.
    let claims = validate_token(&state.jwt_config, &payload.refresh_token).map_err(|_| {
        ApiError(DomainError::AuthError(
            "Invalid or expired refresh token".to_string(),
        ))
    })?;

    // 2. Enforce token_kind = Refresh. Access/Intermediate tokens cannot be
    //    used here even if signed correctly.
    if claims.token_kind != TokenKind::Refresh {
        return Err(ApiError(DomainError::AuthError(
            "refresh token required".to_string(),
        )));
    }

    // 3. Confirm the refresh token is the active one in Redis (rotation +
    //    revocation defense — old refresh tokens stop working as soon as a
    //    newer pair is issued).
    let redis_key = format!("refresh:{}", claims.sub);
    let mut conn = state.redis.clone();
    let stored: Option<String> = conn
        .get(&redis_key)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    match stored {
        Some(ref t) if t == &payload.refresh_token => {}
        _ => {
            return Err(ApiError(DomainError::AuthError(
                "Refresh token not found or revoked".to_string(),
            )));
        }
    }

    // 4. Load the user (must still exist + be active).
    let repo = PgUserRepository::new(state.pool.clone());
    let user = repo
        .find_by_id(claims.sub)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("User not found".to_string())))?;
    if !user.is_active {
        return Err(ApiError(DomainError::AuthError(
            "Account is deactivated".to_string(),
        )));
    }

    // 5. Drop the OLD refresh token from Redis BEFORE minting the new one so
    //    a parallel refresh attempt can't observe both as valid.
    conn.del::<_, ()>(&redis_key)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 6. Re-resolve tenant binding.
    let (tenant_id, role) = if user.is_superadmin {
        // Superadmin tokens stay tenant-less. We do NOT consult memberships
        // even if some exist; superadmin authority flows from is_superadmin.
        (None, None)
    } else {
        // Non-superadmin: token MUST carry tenant_id (intermediate-and-still-
        // unconsumed tokens are not valid Refresh tokens anyway). Missing
        // tenant_id on a non-superadmin Refresh = malformed → 401.
        let tid = claims.tenant_id.ok_or_else(|| {
            ApiError(DomainError::AuthError(
                "refresh token missing tenant_id".to_string(),
            ))
        })?;

        let mut db = state
            .pool
            .acquire()
            .await
            .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
        let role = user_tenant_repo::verify_membership(&mut db, user.id, tid)
            .await?
            .ok_or_else(|| {
                // Membership revoked or tenant suspended/deleted between
                // sessions — kick the user out via 403.
                ApiError(DomainError::Forbidden(
                    "membership_not_found_or_inactive".to_string(),
                ))
            })?;
        (Some(tid), Some(role))
    };

    // 7. Mint the new pair (also persists the new refresh in Redis).
    let (access_token, new_refresh_token) =
        mint_token_pair(&state, user.id, &user.email, tenant_id, user.is_superadmin, role).await?;

    Ok(Json(TokenResponse {
        access_token,
        refresh_token: new_refresh_token,
    }))
}

async fn logout(
    State(state): State<AppState>,
    claims: Claims,
    Json(_payload): Json<RefreshRequest>,
) -> Result<StatusCode, ApiError> {
    let redis_key = format!("refresh:{}", claims.sub);
    let mut conn = state.redis.clone();
    conn.del::<_, ()>(&redis_key)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    Ok(StatusCode::NO_CONTENT)
}

/// `POST /auth/activate` — exchange an invite code for a real password.
///
/// Reuses the same two-step-login resolution as `/auth/login` so newly
/// activated users land in the right state (final-token if 0/1 memberships
/// or superadmin; intermediate-token + memberships list otherwise). Note: an
/// activation flow that ends with `MultiTenant` is unusual but possible if
/// memberships were granted ahead of time — we do not invent special-case
/// behavior here.
async fn activate_invite(
    State(state): State<AppState>,
    Json(payload): Json<ActivateRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let repo = PgUserRepository::new(state.pool.clone());

    let user = repo
        .find_by_email(&payload.email)
        .await?
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid credentials".to_string())))?;

    if !user.must_set_password {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    let expires_at = user
        .invite_expires_at
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid email or code".to_string())))?;
    if chrono::Utc::now() > expires_at {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    let stored_hash = user
        .invite_code_hash
        .as_deref()
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid email or code".to_string())))?;
    let code_valid = verify_password(&payload.code, stored_hash)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    if !code_valid {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    if payload.new_password.len() < 8 {
        return Err(ApiError(DomainError::Validation(
            "Password must be at least 8 characters".to_string(),
        )));
    }

    let new_hash = hash_password(&payload.new_password)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    repo.activate_invite(user.id, &new_hash).await?;

    // Reuse the same dispatch as /auth/login. Re-fetch the user so we observe
    // the post-activation state (must_set_password = false).
    let user = repo
        .find_by_id(user.id)
        .await?
        .ok_or_else(|| ApiError(DomainError::Internal("user vanished post-activate".to_string())))?;

    if user.is_superadmin {
        let (access_token, refresh_token) =
            mint_token_pair(&state, user.id, &user.email, None, true, None).await?;
        return Ok(Json(build_final_response(
            &user,
            access_token,
            refresh_token,
            None,
            None,
        )));
    }

    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    let memberships = user_tenant_repo::list_for_user(&mut conn, user.id).await?;
    drop(conn);

    match memberships.as_slice() {
        [] => Err(ApiError(DomainError::Forbidden(
            "no_tenant_access".to_string(),
        ))),
        [single] => {
            let tenant_dto = TenantDto {
                id: single.tenant_id,
                slug: single.tenant_slug.clone().unwrap_or_default(),
                name: single.tenant_name.clone().unwrap_or_default(),
            };
            let (access_token, refresh_token) = mint_token_pair(
                &state,
                user.id,
                &user.email,
                Some(single.tenant_id),
                false,
                Some(single.role),
            )
            .await?;
            Ok(Json(build_final_response(
                &user,
                access_token,
                refresh_token,
                Some(tenant_dto),
                Some(single.role),
            )))
        }
        many => {
            let intermediate_token =
                create_intermediate_token(&state.jwt_config, user.id, &user.email)
                    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
            let dtos = many.iter().map(membership_to_dto).collect();
            Ok(Json(LoginResponse::MultiTenant {
                intermediate_token,
                memberships: dtos,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    //! Pure unit tests for response shapes and token-kind gates.
    //!
    //! Full HTTP/DB scenarios for /auth/* live in the Phase E integration
    //! suite under `backend/crates/api/tests/`:
    //!
    //!   * Membership revoked between sessions → 401/403 — covered by
    //!     `multi_tenant_isolation::revoked_membership_yields_401_or_403_on_next_request`.
    //!   * Suspended tenant on /auth/refresh → 403 — covered by
    //!     `multi_tenant_isolation::suspended_tenant_rejects_refresh_with_403`.
    //!   * SQL-layer isolation (cross-tenant SELECT/UPDATE/DELETE/INSERT)
    //!     under the non-superuser app pool — covered by
    //!     `rls_sql::*` (Phase E4).
    //!
    //! Remaining auth-route scenarios that the Phase E suite does NOT yet
    //! cover (and which would require additional fixtures rather than the
    //! `seed_tenant_with_owner` harness):
    //!   - Bad creds → 401 on /auth/login.
    //!   - Zero-membership user → 403 on /auth/login.
    //!   - Multi-membership user → MultiTenant intermediate token shape.
    //!   - Intermediate-token-kind wrong-kind on /auth/refresh → 401.
    //! These are tracked as a post-archive nice-to-have; the higher-value
    //! security paths are covered.

    use super::*;
    use vandepot_infra::auth::jwt::JwtConfig;

    fn cfg() -> JwtConfig {
        JwtConfig {
            secret: "unit-test-secret-with-enough-bytes".to_string(),
            access_expiration: 900,
            refresh_expiration: 604_800,
            intermediate_expiration: 60,
        }
    }

    #[test]
    fn login_response_final_serializes_with_access_token() {
        let resp = LoginResponse::Final {
            access_token: "a".into(),
            refresh_token: "r".into(),
            user: UserDto {
                id: Uuid::nil(),
                email: "u@x.com".into(),
                name: "U".into(),
                is_superadmin: false,
            },
            tenant: Some(TenantDto {
                id: Uuid::nil(),
                slug: "acme".into(),
                name: "Acme".into(),
            }),
            role: Some(TenantRole::Manager),
            is_superadmin: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["access_token"], "a");
        assert_eq!(json["refresh_token"], "r");
        assert_eq!(json["role"], "manager");
        assert_eq!(json["tenant"]["slug"], "acme");
        assert!(json.get("intermediate_token").is_none());
    }

    #[test]
    fn login_response_multi_tenant_serializes_with_intermediate_token() {
        let resp = LoginResponse::MultiTenant {
            intermediate_token: "i".into(),
            memberships: vec![MembershipDto {
                tenant_id: Uuid::nil(),
                tenant_slug: "acme".into(),
                tenant_name: "Acme".into(),
                role: TenantRole::Owner,
            }],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["intermediate_token"], "i");
        assert_eq!(json["memberships"][0]["tenant_slug"], "acme");
        assert_eq!(json["memberships"][0]["role"], "owner");
        assert!(json.get("access_token").is_none());
    }

    #[test]
    fn superadmin_final_response_has_null_tenant_and_role() {
        let resp = LoginResponse::Final {
            access_token: "a".into(),
            refresh_token: "r".into(),
            user: UserDto {
                id: Uuid::nil(),
                email: "admin@x.com".into(),
                name: "Admin".into(),
                is_superadmin: true,
            },
            tenant: None,
            role: None,
            is_superadmin: true,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json["tenant"].is_null());
        assert!(json["role"].is_null());
        assert_eq!(json["is_superadmin"], true);
    }

    #[test]
    fn intermediate_token_kind_is_distinct_from_refresh_and_access() {
        // Sanity: prove the kind discriminator we check on /auth/select-tenant
        // and /auth/refresh actually round-trips.
        let user = Uuid::new_v4();
        let intermediate = create_intermediate_token(&cfg(), user, "u@x.com").unwrap();
        let refresh = create_refresh_token(&cfg(), user, "u@x.com", Some(Uuid::new_v4()), false, Some(TenantRole::Operator)).unwrap();
        let access = create_access_token(&cfg(), user, "u@x.com", Some(Uuid::new_v4()), false, Some(TenantRole::Operator)).unwrap();

        let dec_int = validate_token(&cfg(), &intermediate).unwrap();
        let dec_ref = validate_token(&cfg(), &refresh).unwrap();
        let dec_acc = validate_token(&cfg(), &access).unwrap();

        // /auth/select-tenant accepts only Intermediate.
        assert_eq!(dec_int.token_kind, TokenKind::Intermediate);
        assert_ne!(dec_ref.token_kind, TokenKind::Intermediate);
        assert_ne!(dec_acc.token_kind, TokenKind::Intermediate);

        // /auth/refresh accepts only Refresh.
        assert_eq!(dec_ref.token_kind, TokenKind::Refresh);
        assert_ne!(dec_int.token_kind, TokenKind::Refresh);
        assert_ne!(dec_acc.token_kind, TokenKind::Refresh);
    }

    #[test]
    fn membership_dto_round_trips_role_as_lowercase() {
        let dto = MembershipDto {
            tenant_id: Uuid::nil(),
            tenant_slug: "acme".into(),
            tenant_name: "Acme".into(),
            role: TenantRole::Operator,
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["role"], "operator");
    }
}
