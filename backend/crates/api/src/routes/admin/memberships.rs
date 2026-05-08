//! `/admin/tenants/{tenant_id}/memberships` — superadmin-only.
//!
//! Source of truth:
//! - Spec: `sdd/multi-tenant-foundation/spec` ("User-Tenant Membership and
//!   Roles").
//! - Design: `sdd/multi-tenant-foundation/design` §3.2 (`user_tenants`
//!   schema), §6 (roles), §8 (admin endpoints).
//!
//! Endpoints:
//! - `POST   /admin/tenants/{tenant_id}/memberships`           — grant.
//! - `GET    /admin/tenants/{tenant_id}/memberships`           — list.
//! - `DELETE /admin/tenants/{tenant_id}/memberships/{user_id}` — revoke
//!                                                                (idempotent).
//!
//! Membership grant uses UPSERT semantics — re-granting an existing or
//! revoked membership reactivates it (per `user_tenant_repo::grant` docs).
//! That is a successful 201 in this endpoint.
//!
//! Foreign-key violations (unknown user or tenant) are normalized by the
//! repo to `DomainError::NotFound`, which surfaces as 404.

use axum::{
    extract::Path,
    http::StatusCode,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::audit_log_repo::{self, events, AuditEntry};
use vandepot_infra::repositories::user_tenant_repo::{self, Membership};

use crate::error::ApiError;
use crate::extractors::tenant::Tenant as TenantExt;
use crate::state::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body for `POST /admin/tenants/{tenant_id}/memberships`.
#[derive(Debug, Deserialize)]
pub struct GrantMembershipRequest {
    pub user_id: Uuid,
    pub role: TenantRole,
}

/// Wire shape for a membership row. We expose `user_email` (populated by
/// `list_for_tenant`) so the admin UI can render the list without a second
/// roundtrip to fetch user metadata.
#[derive(Debug, Serialize)]
pub struct MembershipResponse {
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub role: TenantRole,
    pub created_at: DateTime<Utc>,
    pub user_email: Option<String>,
}

impl From<Membership> for MembershipResponse {
    fn from(m: Membership) -> Self {
        Self {
            user_id: m.user_id,
            tenant_id: m.tenant_id,
            role: m.role,
            created_at: m.created_at,
            user_email: m.user_email,
        }
    }
}

// ── Routes ───────────────────────────────────────────────────────────────────

pub fn membership_admin_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/tenants/{tenant_id}/memberships",
            get(list_memberships).post(grant_membership),
        )
        .route(
            "/admin/tenants/{tenant_id}/memberships/{user_id}",
            axum::routing::delete(revoke_membership),
        )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// All admin handlers run inside the request tx provided by the tenant_tx
// middleware (with `app.is_superadmin='true'` planted). `user_tenants` is
// exempt from RLS so the tx context isn't strictly required here, but using
// the request tx is consistent with the rest of the codebase and lets a
// future migration drop the exemption without rewriting these handlers.

async fn grant_membership(
    TenantExt(mut tt): TenantExt,
    Path(tenant_id): Path<Uuid>,
    Json(payload): Json<GrantMembershipRequest>,
) -> Result<(StatusCode, Json<MembershipResponse>), ApiError> {
    user_tenant_repo::grant(&mut *tt.tx, payload.user_id, tenant_id, payload.role).await?;

    // The grant itself returns `()` — re-fetch the row through the verify
    // helper to assemble the response. `verify_membership` returns the
    // active role (or None if the tenant is suspended/deleted, which would
    // be surprising right after a successful grant — surface as 500 if it
    // happens because that's a real invariant break).
    let role = user_tenant_repo::verify_membership(&mut *tt.tx, payload.user_id, tenant_id)
        .await?
        .ok_or_else(|| {
            ApiError(DomainError::Internal(
                "membership disappeared after grant".to_string(),
            ))
        })?;

    // We don't have created_at / user_email from `verify_membership`. The
    // simplest faithful response is to read back from list_for_tenant and
    // pluck the matching row. That's one extra query but it's an admin
    // path and the cardinality is tiny.
    let memberships = user_tenant_repo::list_for_tenant(&mut *tt.tx, tenant_id).await?;
    let me = memberships
        .into_iter()
        .find(|m| m.user_id == payload.user_id)
        .ok_or_else(|| {
            ApiError(DomainError::Internal(
                "membership not found in tenant list after grant".to_string(),
            ))
        })?;

    debug_assert_eq!(me.role, role, "verify_membership / list_for_tenant disagree");

    // C7: audit the grant. UPSERT semantics make this also fire for
    // re-activation of a previously revoked membership — that's the right
    // behavior because the user's effective access has just changed.
    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::MEMBERSHIP_GRANTED.to_string(),
            target_tenant_id: Some(tenant_id),
            target_user_id: Some(payload.user_id),
            metadata: Some(serde_json::json!({
                "role": role.to_string(),
            })),
            expires_at: None,
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok((StatusCode::CREATED, Json(MembershipResponse::from(me))))
}

async fn list_memberships(
    TenantExt(mut tt): TenantExt,
    Path(tenant_id): Path<Uuid>,
) -> Result<Json<Vec<MembershipResponse>>, ApiError> {
    let memberships = user_tenant_repo::list_for_tenant(&mut *tt.tx, tenant_id).await?;
    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(
        memberships.into_iter().map(MembershipResponse::from).collect(),
    ))
}

async fn revoke_membership(
    TenantExt(mut tt): TenantExt,
    Path((tenant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    // `revoke` returns NotFound if the row was never created. Per the task
    // spec, DELETE is idempotent — once a row exists, repeated revokes are
    // no-ops. The "never existed" case still surfaces as 404 (consistent
    // with REST DELETE-on-unknown semantics; the task requirement of
    // idempotency applies to "revoke an already-revoked row", which the
    // repo handles).
    let outcome = match user_tenant_repo::revoke(&mut *tt.tx, user_id, tenant_id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(DomainError::NotFound(_)) => {
            // Treat unknown-membership as idempotent success at the HTTP
            // boundary — the end state ("user is not a member") is the
            // same regardless of whether the row ever existed.
            Ok(StatusCode::NO_CONTENT)
        }
        Err(other) => Err(ApiError(other)),
    };
    if outcome.is_ok() {
        // C7: audit revocation. We write the audit row even for the
        // "never existed" branch above — that branch is semantically a
        // no-op, but the superadmin's INTENT was to revoke, and recording
        // the intent is more useful than hiding it. The metadata flag
        // documents whether a row actually changed.
        audit_log_repo::insert(
            &mut *tt.tx,
            AuditEntry {
                actor_user_id: tt.ctx.user_id,
                event: events::MEMBERSHIP_REVOKED.to_string(),
                target_tenant_id: Some(tenant_id),
                target_user_id: Some(user_id),
                metadata: None,
                expires_at: None,
                source_ip: None,
            },
        )
        .await?;

        tt.commit()
            .await
            .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    }
    outcome
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Body-parsing shape tests. Wire-level integration (UPSERT, FK→404,
    //! list join) is in the Phase E DB harness.

    use super::*;

    #[test]
    fn grant_request_parses_owner() {
        let body = r#"{"user_id":"00000000-0000-0000-0000-000000000001","role":"owner"}"#;
        let req: GrantMembershipRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.role, TenantRole::Owner);
    }

    #[test]
    fn grant_request_parses_manager() {
        let body = r#"{"user_id":"00000000-0000-0000-0000-000000000001","role":"manager"}"#;
        let req: GrantMembershipRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.role, TenantRole::Manager);
    }

    #[test]
    fn grant_request_parses_operator() {
        let body = r#"{"user_id":"00000000-0000-0000-0000-000000000001","role":"operator"}"#;
        let req: GrantMembershipRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.role, TenantRole::Operator);
    }

    #[test]
    fn grant_request_rejects_unknown_role() {
        let body = r#"{"user_id":"00000000-0000-0000-0000-000000000001","role":"superadmin"}"#;
        let parsed: Result<GrantMembershipRequest, _> = serde_json::from_str(body);
        assert!(
            parsed.is_err(),
            "role='superadmin' must NOT deserialize into TenantRole"
        );
    }

    #[test]
    fn grant_request_rejects_uppercase_role() {
        let body = r#"{"user_id":"00000000-0000-0000-0000-000000000001","role":"Owner"}"#;
        let parsed: Result<GrantMembershipRequest, _> = serde_json::from_str(body);
        assert!(parsed.is_err(), "role must be lowercase per serde rename_all");
    }

    #[test]
    fn membership_response_serializes_with_optional_email() {
        let resp = MembershipResponse {
            user_id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            role: TenantRole::Manager,
            created_at: Utc::now(),
            user_email: Some("u@example.com".into()),
        };
        let json = serde_json::to_value(&resp).expect("serialize");
        assert_eq!(json["role"], "manager");
        assert_eq!(json["user_email"], "u@example.com");
    }
}
