//! `/admin/tenants/*` — superadmin-only tenant CRUD.
//!
//! Source of truth:
//! - Spec: `sdd/multi-tenant-foundation/spec` ("Tenants Entity and Lifecycle").
//! - Design: `sdd/multi-tenant-foundation/design` §3 (schema), §8 (admin
//!   endpoints).
//!
//! Endpoints:
//! - `POST   /admin/tenants`           — create tenant.
//! - `GET    /admin/tenants`           — list (active by default; pass
//!                                        `?include_suspended=true` to also
//!                                        include suspended).
//! - `GET    /admin/tenants/{id}`      — fetch one. 404 if soft-deleted/absent.
//! - `PATCH  /admin/tenants/{id}`      — partial update (name, status).
//! - `DELETE /admin/tenants/{id}`      — soft-delete (idempotent → 204).
//!
//! The superadmin guard wraps the entire `/admin/*` sub-tree
//! ([`crate::routes::admin::admin_routes`]); these handlers do not re-check
//! `is_superadmin` themselves.
//!
//! Error mapping (per task A10 + design §5.5):
//! - Reserved/invalid slug, empty name → `422 Unprocessable Entity`
//!   (surfaces from `tenant_repo::create` as `DomainError::Validation`).
//! - Slug uniqueness collision         → `409 Conflict` (`DomainError::Conflict`).
//! - Soft-deleted/absent tenant         → `404 Not Found`.
//! - Otherwise repository errors flow through `ApiError`.

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::tenant::{Tenant, TenantStatus};
use vandepot_infra::repositories::audit_log_repo::{self, events, AuditEntry};
use vandepot_infra::repositories::tenant_repo;

use crate::error::ApiError;
use crate::extractors::tenant::Tenant as TenantExt;
use crate::state::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body for `POST /admin/tenants`.
#[derive(Debug, Deserialize)]
pub struct CreateTenantRequest {
    pub slug: String,
    pub name: String,
}

/// Query string for `GET /admin/tenants`.
#[derive(Debug, Default, Deserialize)]
pub struct ListTenantsQuery {
    /// When `true`, include `status='suspended'` rows alongside `active`.
    /// Soft-deleted rows are NEVER returned. Default: `false`.
    #[serde(default)]
    pub include_suspended: bool,
}

/// Body for `PATCH /admin/tenants/{id}`. All fields optional; only the
/// provided ones are touched.
#[derive(Debug, Deserialize)]
pub struct UpdateTenantRequest {
    pub name: Option<String>,
    pub status: Option<TenantStatus>,
}

// ── Routes ───────────────────────────────────────────────────────────────────

pub fn tenant_admin_routes() -> Router<AppState> {
    Router::new()
        .route("/admin/tenants", post(create_tenant).get(list_tenants))
        .route(
            "/admin/tenants/{id}",
            get(get_tenant).patch(update_tenant).delete(delete_tenant),
        )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// All admin handlers run inside the request tx provided by the tenant_tx
// middleware. The middleware plants `app.is_superadmin='true'` on that tx
// (the superadmin guard already authenticated the caller), so writes against
// RLS-bound tables (e.g. `stock_configuration` from
// `tenant_repo::create`'s replicate step) bypass policy. Using `tt.tx`
// instead of acquiring a fresh connection from `state.pool` is what makes
// the bypass work — `set_config(...)` is bound to the tx connection.

async fn create_tenant(
    TenantExt(mut tt): TenantExt,
    Json(payload): Json<CreateTenantRequest>,
) -> Result<(StatusCode, Json<Tenant>), ApiError> {
    // Pre-validate non-empty inputs before hitting the DB. The repo layer
    // also enforces format/reserved checks, but bouncing trivially-invalid
    // input here yields a clearer error.
    let slug = payload.slug.trim();
    let name = payload.name.trim();
    if slug.is_empty() {
        return Err(ApiError(DomainError::Validation(
            "slug must not be empty".to_string(),
        )));
    }
    if name.is_empty() {
        return Err(ApiError(DomainError::Validation(
            "name must not be empty".to_string(),
        )));
    }

    // B8.3: tenant_repo::create now also replicates per-tenant defaults
    // (stock_configuration global row). Both run inside the request tx so a
    // downstream failure rolls the tenant insert back too.
    let tenant = tenant_repo::create(&mut *tt.tx, slug, name).await?;

    // C7: append audit row inside the same tx so a downstream failure
    // (commit error, etc.) rolls both the tenant and the audit row back.
    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::TENANT_CREATED.to_string(),
            target_tenant_id: Some(tenant.id),
            target_user_id: None,
            metadata: Some(serde_json::json!({
                "slug": tenant.slug,
                "name": tenant.name,
            })),
            expires_at: None,
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(tenant)))
}

async fn list_tenants(
    TenantExt(mut tt): TenantExt,
    Query(query): Query<ListTenantsQuery>,
) -> Result<Json<Vec<Tenant>>, ApiError> {
    let tenants = tenant_repo::list(&mut *tt.tx, query.include_suspended).await?;
    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(tenants))
}

async fn get_tenant(
    TenantExt(mut tt): TenantExt,
    Path(id): Path<Uuid>,
) -> Result<Json<Tenant>, ApiError> {
    let tenant = tenant_repo::get_by_id(&mut *tt.tx, id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Tenant not found".to_string())))?;
    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(tenant))
}

async fn update_tenant(
    TenantExt(mut tt): TenantExt,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateTenantRequest>,
) -> Result<Json<Tenant>, ApiError> {
    // Validate optional name when present.
    let name_trimmed = payload.name.as_deref().map(str::trim);
    if let Some(n) = name_trimmed {
        if n.is_empty() {
            return Err(ApiError(DomainError::Validation(
                "name must not be empty".to_string(),
            )));
        }
    }

    let tenant = tenant_repo::update(&mut *tt.tx, id, name_trimmed, payload.status).await?;

    // C7: audit the update. We capture the post-update name/status so a
    // diff can be reconstructed by reading consecutive audit rows for the
    // same target_tenant_id.
    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::TENANT_UPDATED.to_string(),
            target_tenant_id: Some(tenant.id),
            target_user_id: None,
            metadata: Some(serde_json::json!({
                "name": tenant.name,
                "status": tenant.status.as_str(),
            })),
            expires_at: None,
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(tenant))
}

async fn delete_tenant(
    TenantExt(mut tt): TenantExt,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    // soft_delete is idempotent — re-deleting an already-deleted tenant is
    // a no-op (see tenant_repo::soft_delete docs).
    tenant_repo::soft_delete(&mut *tt.tx, id).await?;

    // C7: audit the suspension. We name the event `tenant.suspended`
    // (matching the spec wording) rather than `tenant.deleted` because the
    // row is soft-deleted — the data persists for audit and only the
    // status flips to suspended + deleted_at is set.
    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::TENANT_SUSPENDED.to_string(),
            target_tenant_id: Some(id),
            target_user_id: None,
            metadata: None,
            expires_at: None,
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Validation-shape unit tests. End-to-end coverage (DB roundtrips, slug
    //! collisions, etc.) is deferred to the Phase E integration suite.

    use super::*;

    #[test]
    fn create_request_deserializes_minimal_body() {
        let body = r#"{"slug":"acme","name":"Acme Co"}"#;
        let req: CreateTenantRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.slug, "acme");
        assert_eq!(req.name, "Acme Co");
    }

    #[test]
    fn update_request_accepts_partial_body() {
        let body = r#"{"name":"New Name"}"#;
        let req: UpdateTenantRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.name.as_deref(), Some("New Name"));
        assert!(req.status.is_none());
    }

    #[test]
    fn update_request_accepts_status_transition() {
        let body = r#"{"status":"suspended"}"#;
        let req: UpdateTenantRequest = serde_json::from_str(body).expect("parse");
        assert!(req.name.is_none());
        assert_eq!(req.status, Some(TenantStatus::Suspended));
    }

    #[test]
    fn update_request_rejects_invalid_status() {
        let body = r#"{"status":"deleted"}"#;
        let parsed: Result<UpdateTenantRequest, _> = serde_json::from_str(body);
        assert!(parsed.is_err(), "invalid status string should fail to parse");
    }

    #[test]
    fn list_query_defaults_to_active_only() {
        // ListTenantsQuery has `#[serde(default)]` on `include_suspended`,
        // so an empty body should yield `false`. Use the JSON shape for
        // the unit test (the wire format is querystring; `axum::extract::Query`
        // converts before deserializing).
        let q: ListTenantsQuery = serde_json::from_str("{}").expect("parse empty");
        assert!(!q.include_suspended);
    }

    #[test]
    fn list_query_parses_include_suspended_true() {
        let q: ListTenantsQuery =
            serde_json::from_str(r#"{"include_suspended":true}"#).expect("parse");
        assert!(q.include_suspended);
    }
}
