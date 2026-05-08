//! Superadmin-only guard for the `/admin` sub-router.
//!
//! Source of truth: `sdd/multi-tenant-foundation/design` §8 (admin endpoints
//! are superadmin-only in v1) and `sdd/multi-tenant-foundation/spec`
//! ("Superadmin Powers and Cross-Tenant Operations").
//!
//! Wraps every admin route with an Axum `from_fn_with_state` middleware that:
//! - extracts a [`Claims`] payload from the request via the existing
//!   `FromRequestParts<AppState>` impl,
//! - rejects with **401 Unauthorized** when no Bearer token is present or the
//!   token is invalid/expired (the [`Claims`] extractor surfaces this),
//! - rejects with **403 Forbidden** when the caller is authenticated but
//!   `is_superadmin == false`,
//! - otherwise lets the handler run.
//!
//! The middleware does NOT inject the claims into request extensions — admin
//! handlers can re-extract `Claims` themselves if they need the user id (e.g.
//! for audit). This keeps the guard tightly scoped to authorization.
//!
//! The pure decision predicate [`decide`] is exposed (crate-private) so unit
//! tests can exercise the 401/403/200 matrix without spinning up a full
//! `AppState` (the existing `Claims` extractor already has its own coverage).

use axum::{
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use vandepot_infra::auth::jwt::Claims;

use crate::state::AppState;

/// Pure decision: returns `Ok(())` if the (already-authenticated) caller is a
/// superadmin, otherwise an `(status, json_body)` tuple ready to be turned
/// into a `Response`. Pulled out of the middleware so it can be unit-tested
/// without an `AppState`.
pub(crate) fn decide(claims: &Claims) -> Result<(), (StatusCode, serde_json::Value)> {
    if claims.is_superadmin {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            json!({"error": "Superadmin privileges required"}),
        ))
    }
}

/// Tower middleware that enforces `Claims.is_superadmin == true`.
///
/// Returns:
/// - `401 Unauthorized` when the token is missing or invalid (delegated to
///   the `Claims` extractor's rejection),
/// - `403 Forbidden` when the token is valid but the caller is not a
///   superadmin,
/// - the handler's response otherwise.
pub async fn superadmin_guard(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();

    // Re-use the existing `Claims` extractor. Its rejection is already a 401
    // response with the standard JSON error body.
    let claims = match Claims::from_request_parts(&mut parts, &state).await {
        Ok(claims) => claims,
        Err(rejection) => return rejection,
    };

    if let Err((status, body)) = decide(&claims) {
        return (status, Json(body)).into_response();
    }

    let request = Request::from_parts(parts, body);
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use vandepot_infra::auth::jwt::{Claims, TokenKind};
    use vandepot_infra::auth::tenant_context::TenantRole;

    fn mk_claims(is_superadmin: bool, role: Option<TenantRole>) -> Claims {
        Claims {
            sub: Uuid::nil(),
            email: "tester@example.com".into(),
            tenant_id: if is_superadmin {
                None
            } else {
                Some(Uuid::from_u128(1))
            },
            is_superadmin,
            role,
            token_kind: TokenKind::Access,
            exp: 0,
            iat: 0,
        }
    }

    #[test]
    fn superadmin_passes() {
        let claims = mk_claims(true, None);
        assert!(decide(&claims).is_ok());
    }

    #[test]
    fn non_superadmin_with_role_is_forbidden() {
        for role in [TenantRole::Owner, TenantRole::Manager, TenantRole::Operator] {
            let claims = mk_claims(false, Some(role));
            let err = decide(&claims).expect_err("non-superadmin must be denied");
            assert_eq!(err.0, StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn non_superadmin_without_role_is_forbidden() {
        // Intermediate-token shape (no role, no tenant) should also be denied.
        let claims = mk_claims(false, None);
        let err = decide(&claims).expect_err("intermediate token must be denied");
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    // NOTE: end-to-end tests covering the 401 path (missing/invalid Bearer
    // header) are deferred to the Phase E integration suite — that exercises
    // the full `Claims` extractor against a real `AppState`. The decision
    // matrix above covers the 403/200 branches that this middleware owns.
}
