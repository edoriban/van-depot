//! `POST /admin/tenants/{tenant_id}/seed-demo` — superadmin-only.
//!
//! Source of truth:
//! - Spec: `sdd/multi-tenant-foundation/spec` ("Demo Seed").
//! - Design: `sdd/multi-tenant-foundation/design` §8.3 (per-tenant demo seed
//!   via admin endpoint).
//! - Tasks: `sdd/multi-tenant-foundation/tasks` D2.
//!
//! Idempotent. Re-running on an already-seeded tenant returns the same HTTP
//! 200 envelope with every counter in `summary` at zero — proof that no rows
//! were inserted by this call (existing rows were preserved).
//!
//! ## Auth + transaction
//!
//! The superadmin guard authenticates the caller; the `tenant_tx` middleware
//! plants `app.is_superadmin='true'` on the per-request transaction so RLS
//! policies on every tenant-scoped table grant a bypass — that's how the
//! seed can write into a tenant other than the caller's own. The seed runs
//! in the same tx so a downstream commit failure rolls every inserted row
//! back together.
//!
//! ## Audit
//!
//! Each successful call writes one `audit_log` row with
//! `event = "tenant.seed_demo"`, `target_tenant_id` set, and `metadata`
//! carrying the [`SeedSummary`] counters serialized as JSON.

use axum::{
    extract::Path,
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::Serialize;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::tenant::TenantStatus;
use vandepot_infra::repositories::audit_log_repo::{self, events, AuditEntry};
use vandepot_infra::repositories::tenant_repo;
use vandepot_infra::seed::{seed_demo_for_tenant, SeedSummary};

use crate::error::ApiError;
use crate::extractors::tenant::Tenant as TenantExt;
use crate::state::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SeedDemoResponse {
    pub tenant: TenantSummary,
    pub summary: SeedSummary,
}

#[derive(Debug, Serialize)]
pub struct TenantSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

// ── Routes ───────────────────────────────────────────────────────────────────

pub fn seed_demo_admin_routes() -> Router<AppState> {
    Router::new().route(
        "/admin/tenants/{tenant_id}/seed-demo",
        post(seed_demo_handler),
    )
}

// ── Handler ──────────────────────────────────────────────────────────────────

async fn seed_demo_handler(
    TenantExt(mut tt): TenantExt,
    Path(tenant_id): Path<Uuid>,
) -> Result<(StatusCode, Json<SeedDemoResponse>), ApiError> {
    // 1. Verify the target tenant exists and is active. Soft-deleted /
    //    suspended → 404, mirroring `impersonate_tenant` (admin-only routes
    //    surface "not impersonatable / not seedable" as 404 to keep response
    //    shape uniform).
    let tenant = tenant_repo::get_by_id(&mut *tt.tx, tenant_id)
        .await?
        .ok_or_else(|| ApiError(DomainError::NotFound("Tenant not found".to_string())))?;

    if tenant.status != TenantStatus::Active {
        return Err(ApiError(DomainError::NotFound(
            "Tenant not found or not active".to_string(),
        )));
    }

    // 2. Run the per-tenant demo seed inside the admin tx (carries
    //    `app.is_superadmin='true'`). Returns SeedSummary with newly-inserted
    //    counts (zero on a fully idempotent re-run).
    let summary = seed_demo_for_tenant(&mut *tt.tx, tenant_id).await?;

    // 3. Append audit row. Metadata embeds the full summary so downstream
    //    auditors can reconstruct the inserted volume per call.
    let metadata = serde_json::to_value(&summary).map_err(|e| {
        ApiError(DomainError::Internal(format!(
            "serialize seed summary: {e}"
        )))
    })?;

    audit_log_repo::insert(
        &mut *tt.tx,
        AuditEntry {
            actor_user_id: tt.ctx.user_id,
            event: events::TENANT_SEED_DEMO.to_string(),
            target_tenant_id: Some(tenant.id),
            target_user_id: None,
            metadata: Some(metadata),
            expires_at: None,
            source_ip: None,
        },
    )
    .await?;

    tt.commit()
        .await
        .map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::OK,
        Json(SeedDemoResponse {
            tenant: TenantSummary {
                id: tenant.id,
                slug: tenant.slug,
                name: tenant.name,
            },
            summary,
        }),
    ))
}

#[cfg(test)]
mod tests {
    //! Shape-only unit tests. End-to-end (DB roundtrip, audit row written,
    //! idempotency on re-run) is exercised in the integration test
    //! `backend/crates/api/tests/admin_seed_demo.rs`.

    use super::*;

    #[test]
    fn response_serializes_summary_inline() {
        let resp = SeedDemoResponse {
            tenant: TenantSummary {
                id: Uuid::nil(),
                slug: "acme".to_string(),
                name: "Acme Co".to_string(),
            },
            summary: SeedSummary {
                warehouses: 2,
                ..Default::default()
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"warehouses\":2"));
        assert!(json.contains("\"slug\":\"acme\""));
    }
}
