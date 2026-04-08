use axum::http::StatusCode;
use axum::{extract::State, Json, Router, routing::post};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use vandepot_domain::error::DomainError;
use vandepot_domain::ports::user_repository::UserRepository;
use vandepot_infra::auth::jwt::{
    create_access_token, create_refresh_token, validate_token, Claims,
};
use vandepot_infra::auth::password::{hash_password, verify_password};
use vandepot_infra::repositories::user_repo::{PgUserRepository, get_user_warehouse_ids};

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct ActivateRequest {
    pub email: String,
    pub code: String,
    pub new_password: String,
}

pub fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/activate", post(activate_invite))
}

async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let repo = PgUserRepository::new(state.pool.clone());

    // 1. Find user by email
    let user = repo
        .find_by_email(&payload.email)
        .await?
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid credentials".to_string())))?;

    // 2. Check must_set_password (invite not yet activated) — before verify_password
    //    because pending users have a placeholder hash that isn't valid Argon2.
    if user.must_set_password {
        return Err(ApiError(DomainError::Forbidden(
            "Account not yet activated. Use your invitation code to set a password.".to_string(),
        )));
    }

    // 3. Verify password
    let valid = verify_password(&payload.password, &user.password_hash)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    if !valid {
        return Err(ApiError(DomainError::AuthError(
            "Invalid credentials".to_string(),
        )));
    }

    // 4. Check is_active
    if !user.is_active {
        return Err(ApiError(DomainError::AuthError(
            "Account is deactivated".to_string(),
        )));
    }

    // 5. Get warehouse_ids
    let warehouse_ids = get_user_warehouse_ids(&state.pool, user.id).await?;

    // 5. Create access + refresh tokens
    let role_str = serde_json::to_value(&user.role)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let access_token = create_access_token(
        &state.jwt_config,
        user.id,
        &user.email,
        &role_str,
        warehouse_ids,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let refresh_token = create_refresh_token(&state.jwt_config, user.id)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 6. Store refresh token in Redis with TTL
    let redis_key = format!("refresh:{}", user.id);
    let expiration = state.jwt_config.refresh_expiration as u64;
    let mut conn = state.redis.clone();
    conn.set_ex::<_, _, ()>(&redis_key, &refresh_token, expiration)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 7. Return tokens
    Ok(Json(TokenResponse {
        access_token,
        refresh_token,
    }))
}

async fn refresh(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    // 1. Validate refresh token
    let claims = validate_token(&state.jwt_config, &payload.refresh_token)
        .map_err(|_| ApiError(DomainError::AuthError("Invalid or expired refresh token".to_string())))?;

    // 2. Check refresh token exists in Redis
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

    // 3. Find user by id from claims
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

    // 4. Delete old refresh token from Redis
    conn.del::<_, ()>(&redis_key)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 5. Get warehouse_ids and create new tokens
    let warehouse_ids = get_user_warehouse_ids(&state.pool, user.id).await?;

    let role_str = serde_json::to_value(&user.role)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let access_token = create_access_token(
        &state.jwt_config,
        user.id,
        &user.email,
        &role_str,
        warehouse_ids,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let new_refresh_token = create_refresh_token(&state.jwt_config, user.id)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 6. Store new refresh token in Redis
    let expiration = state.jwt_config.refresh_expiration as u64;
    conn.set_ex::<_, _, ()>(&redis_key, &new_refresh_token, expiration)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 7. Return new tokens
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
    // 1. Delete refresh token from Redis
    let redis_key = format!("refresh:{}", claims.sub);
    let mut conn = state.redis.clone();
    conn.del::<_, ()>(&redis_key)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 2. Return 204 No Content
    Ok(StatusCode::NO_CONTENT)
}

async fn activate_invite(
    State(state): State<AppState>,
    Json(payload): Json<ActivateRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let repo = PgUserRepository::new(state.pool.clone());

    // 1. Find user by email
    let user = repo
        .find_by_email(&payload.email)
        .await?
        .ok_or_else(|| ApiError(DomainError::AuthError("Invalid credentials".to_string())))?;

    // 2. Check must_set_password
    if !user.must_set_password {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    // 3. Check invite_expires_at
    let expires_at = user.invite_expires_at.ok_or_else(|| {
        ApiError(DomainError::AuthError("Invalid email or code".to_string()))
    })?;
    if chrono::Utc::now() > expires_at {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    // 4. Verify invite code against stored hash
    let stored_hash = user.invite_code_hash.as_deref().ok_or_else(|| {
        ApiError(DomainError::AuthError("Invalid email or code".to_string()))
    })?;
    let code_valid = verify_password(&payload.code, stored_hash)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    if !code_valid {
        return Err(ApiError(DomainError::AuthError(
            "Invalid email or code".to_string(),
        )));
    }

    // 5. Validate new password length
    if payload.new_password.len() < 8 {
        return Err(ApiError(DomainError::Validation(
            "Password must be at least 8 characters".to_string(),
        )));
    }

    // 6. Hash new password and activate
    let new_hash = hash_password(&payload.new_password)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    repo.activate_invite(user.id, &new_hash).await?;

    // 7. Get warehouse_ids and issue tokens
    let warehouse_ids = get_user_warehouse_ids(&state.pool, user.id).await?;

    let role_str = serde_json::to_value(&user.role)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let access_token = create_access_token(
        &state.jwt_config,
        user.id,
        &user.email,
        &role_str,
        warehouse_ids,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    let refresh_token = create_refresh_token(&state.jwt_config, user.id)
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 8. Store refresh token in Redis with TTL
    let redis_key = format!("refresh:{}", user.id);
    let expiration = state.jwt_config.refresh_expiration as u64;
    let mut conn = state.redis.clone();
    conn.set_ex::<_, _, ()>(&redis_key, &refresh_token, expiration)
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 9. Return tokens
    Ok(Json(TokenResponse {
        access_token,
        refresh_token,
    }))
}
