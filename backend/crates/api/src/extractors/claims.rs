//! Axum extractor that pulls the `Claims` payload from a Bearer token.
//!
//! Also exposes [`tenant_context_from_claims`], the temporary bridge that
//! lifts the JWT payload into the canonical [`TenantContext`] used by
//! `role_guard::require_role`. Once tasks C2/C3 land the proper `Tenant`
//! extractor, every handler will receive a `TenantContext` directly and this
//! adapter can retire.

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use vandepot_infra::auth::jwt::{validate_token, Claims};
use vandepot_infra::auth::tenant_context::TenantContext;

use crate::state::AppState;

impl FromRequestParts<AppState> for Claims {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"error": "Missing authorization header"})),
                )
                    .into_response()
            })?;

        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Invalid authorization format"})),
            )
                .into_response()
        })?;

        validate_token(&state.jwt_config, token).map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Invalid or expired token"})),
            )
                .into_response()
        })
    }
}

/// Lifts a `Claims` payload into the canonical [`TenantContext`].
///
/// This is a stop-gap for A6: today's handlers receive `Claims` and need a
/// `TenantContext` to call `require_role` (the canonical signature). The
/// proper `Tenant` extractor (tasks C2/C3) will replace this entirely.
pub fn tenant_context_from_claims(claims: &Claims) -> TenantContext {
    TenantContext {
        user_id: claims.sub,
        tenant_id: claims.tenant_id,
        is_superadmin: claims.is_superadmin,
        role: claims.role,
    }
}
