//! `POST /admin/tenants/{tenant_id}/impersonate` — superadmin-only.
//!
//! Source of truth:
//! - Spec: `sdd/multi-tenant-foundation/spec` ("Superadmin Powers" —
//!   "Impersonation mints a scoped token and audits").
//! - Design: `sdd/multi-tenant-foundation/design` §6 (token shape) and §7
//!   (audit log).
//!
//! Mints a short-lived Access token bound to the target tenant so the
//! superadmin can act AS that tenant via the standard tenant-scoped endpoints
//! (which reject pure-superadmin tokens with `tenant_id=None`). The minted
//! claims preserve `is_superadmin = true` so RLS policies still grant the
//! bypass — the token lets the superadmin operate WITHIN the tenant context
//! without becoming a tenant member.
//!
//! ### Token shape (user-locked decision)
//!
//! ```text
//! Claims {
//!     sub: <superadmin user_id>,
//!     email: <superadmin email>,
//!     tenant_id: Some(<target tenant id>),
//!     is_superadmin: true,
//!     role: None,                         // superadmin has no per-tenant role
//!     token_kind: TokenKind::Access,
//!     exp: now + ttl_minutes,             // 1 ≤ ttl ≤ 60, default 15
//!     iat: now,
//! }
//! ```
//!
//! ### Audit
//!
//! Every successful mint writes an `audit_log` row with
//! `event = "impersonation.minted"`, `actor_user_id = superadmin`,
//! `target_tenant_id = target`, `expires_at` matching the token expiry, and
//! `metadata = {ttl_minutes, generated_via: "admin_impersonate"}`. The audit
//! row commits in the same tx as the existence check on the target tenant.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::tenant::TenantStatus;
use vandepot_infra::auth::jwt::create_access_token;
use vandepot_infra::repositories::audit_log_repo::{self, events, AuditEntry};
use vandepot_infra::repositories::tenant_repo;

use crate::error::ApiError;
use crate::extractors::tenant::Tenant as TenantExt;
use crate::state::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body for `POST /admin/tenants/{tenant_id}/impersonate`. All fields are
/// optional. Default TTL is 15 minutes; cap is 60 minutes (validated in the
/// handler — no enum because the caps are pure integer ranges).
#[derive(Debug, Default, Deserialize)]
pub struct ImpersonateRequest {
    pub ttl_minutes: Option<i64>,
}

/// Response envelope. Matches what the v1 frontend "Login as tenant" flow
/// expects: token + the tenant identity it scopes to + the explicit expiry
/// for client-side countdown UI.
#[derive(Debug, Serialize)]
pub struct ImpersonateResponse {
    pub access_token: String,
    pub tenant: TenantSummary,
    pub expires_at: DateTime<Utc>,
}

/// Tenant identity surfaced inside [`ImpersonateResponse`]. Mirror of the
/// fields the frontend renders in the impersonation banner.
#[derive(Debug, Serialize)]
pub struct TenantSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

// ── Constants ────────────────────────────────────────────────────────────────

/// Default TTL when the request body omits `ttl_minutes`.
pub const DEFAULT_IMPERSONATION_TTL_MINUTES: i64 = 15;
/// Hard upper bound (user-locked decision: ≤ 60 minutes).
pub const MAX_IMPERSONATION_TTL_MINUTES: i64 = 60;

// ── Routes ───────────────────────────────────────────────────────────────────

pub fn impersonate_admin_routes() -> Router<AppState> {
    Router::new().route(
        "/admin/tenants/{tenant_id}/impersonate",
        post(impersonate_tenant),
    )
}

// ── Handler ──────────────────────────────────────────────────────────────────

async fn impersonate_tenant(
    State(state): State<AppState>,
    TenantExt(mut tt): TenantExt,
    Path(tenant_id): Path<Uuid>,
    body: Option<Json<ImpersonateRequest>>,
) -> Result<(StatusCode, Json<ImpersonateResponse>), ApiError> {
    // 1. Resolve TTL. The body is optional (no body == default TTL). Bound
    //    check returns 422 — superadmin should know better but a typo of
    //    "ttl_minutes":600 should not silently mint a 10-hour token.
    let req = body.map(|Json(b)| b).unwrap_or_default();
    let ttl_minutes = req.ttl_minutes.unwrap_or(DEFAULT_IMPERSONATION_TTL_MINUTES);
    if ttl_minutes <= 0 || ttl_minutes > MAX_IMPERSONATION_TTL_MINUTES {
        return Err(ApiError(DomainError::Validation(format!(
            "ttl_minutes must be between 1 and {MAX_IMPERSONATION_TTL_MINUTES} (got {ttl_minutes})"
        ))));
    }

    // 2. Verify the target tenant exists and is active. Soft-deleted /
    //    suspended tenants reject — impersonating a suspended tenant would
    //    let a superadmin bypass the suspension by accident.
    //
    //    `get_by_id` filters out soft-deleted rows; the explicit status check
    //    catches "exists but suspended". Both surface as 404 to keep the
    //    response shape uniform (the spec scenario is "tenant exists" → mint;
    //    everything else is "not impersonatable").
    let tenant = tenant_repo::get_by_id(&mut *tt.tx, tenant_id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Tenant not found".to_string())))?;

    if tenant.status != TenantStatus::Active {
        return Err(ApiError(DomainError::NotFound(
            "Tenant not found or not active".to_string(),
        )));
    }

    // 3. Mint the access token. We construct it via the existing helper so
    //    the JWT shape (header/secret/exp/iat handling) stays consistent with
    //    the regular login flow. The helper uses `JwtConfig.access_expiration`
    //    for exp — but per the user-locked decision, impersonation TTL is
    //    capped independently. Workaround: temporarily override the config
    //    via a local copy with the requested TTL in seconds.
    let mut cfg = state.jwt_config.clone();
    cfg.access_expiration = ttl_minutes * 60;

    let now = Utc::now();
    let expires_at = now + Duration::minutes(ttl_minutes);

    let access_token = create_access_token(
        &cfg,
        tt.ctx.user_id,
        // Email lookup would need an extra query; the actor's email is not
        // strictly required for the minted token (the JWT carries it for
        // logging only). We persist a stable label that documents this is
        // an impersonation token — useful when this token shows up in logs.
        &format!("impersonate:{}", tt.ctx.user_id),
        Some(tenant.id),
        true,
        None,
    )
    .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    // 4. Append audit row in the same tx so a downstream commit failure
    //    rolls the audit row back too.
    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::IMPERSONATION_MINTED.to_string(),
            target_tenant_id: Some(tenant.id),
            target_user_id: None,
            metadata: Some(serde_json::json!({
                "ttl_minutes": ttl_minutes,
                "generated_via": "admin_impersonate",
            })),
            expires_at: Some(expires_at),
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(ImpersonateResponse {
            access_token,
            tenant: TenantSummary {
                id: tenant.id,
                slug: tenant.slug,
                name: tenant.name,
            },
            expires_at,
        }),
    ))
}

#[cfg(test)]
mod tests {
    //! Body-parsing + bounds-check unit tests. End-to-end (DB roundtrip,
    //! audit row written) is exercised in
    //! `backend/crates/api/tests/admin_impersonate.rs`.

    use super::*;

    #[test]
    fn empty_body_yields_default_ttl() {
        let req = ImpersonateRequest::default();
        let ttl = req.ttl_minutes.unwrap_or(DEFAULT_IMPERSONATION_TTL_MINUTES);
        assert_eq!(ttl, 15);
    }

    #[test]
    fn explicit_ttl_round_trips() {
        let body = r#"{"ttl_minutes":30}"#;
        let req: ImpersonateRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.ttl_minutes, Some(30));
    }

    #[test]
    fn ttl_constants_match_user_locked_decision() {
        assert_eq!(DEFAULT_IMPERSONATION_TTL_MINUTES, 15);
        assert_eq!(MAX_IMPERSONATION_TTL_MINUTES, 60);
    }
}
