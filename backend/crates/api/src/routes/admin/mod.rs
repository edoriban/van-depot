//! Admin sub-router (`/admin/*`) — superadmin-only.
//!
//! Source of truth: `sdd/multi-tenant-foundation/design` §8 and
//! `sdd/multi-tenant-foundation/spec` ("Superadmin Powers"). All routes
//! under this module are gated by [`crate::middleware::superadmin_guard`];
//! the guard rejects with 401 (missing/invalid token) or 403 (not
//! superadmin) before any handler runs.
//!
//! ## Tenant-tx contract (C6)
//!
//! All `/admin/*` handlers run inside the per-request transaction provided
//! by [`crate::middleware::tenant_tx::tenant_tx_middleware`] with
//! `app.is_superadmin='true'` planted on the tx (and `app.current_tenant`
//! left UNSET). RLS policies on every tenant-scoped table grant a bypass
//! when `app.is_superadmin='true'`, so admin handlers can perform
//! cross-tenant operations (e.g. `tenant_repo::create`'s replicate step
//! which writes to `stock_configuration`). Handlers MUST extract via the
//! `Tenant` extractor and use `&mut *tt.tx` — acquiring a fresh
//! connection from the pool would NOT carry the bypass flag and would
//! fail RLS WITH CHECK on the runtime non-superuser app role.
//!
//! v1 scope: tenant CRUD (A10), per-tenant memberships (A11), audit log +
//! impersonation (C7). Tenant owners getting their own admin path is
//! deferred per the locked decisions.

pub mod impersonate;
pub mod memberships;
pub mod seed_demo;
pub mod tenants;

use axum::{
    http::StatusCode,
    middleware::from_fn_with_state,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::middleware::superadmin_guard::superadmin_guard;
use crate::state::AppState;

/// Build the admin sub-router and wrap every nested route with the
/// superadmin guard. Caller (the top-level `app_router`) has the
/// `AppState` and threads it in here.
pub fn admin_routes(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/admin/health", get(admin_health))
        .merge(tenants::tenant_admin_routes())
        .merge(memberships::membership_admin_routes())
        .merge(impersonate::impersonate_admin_routes())
        .merge(seed_demo::seed_demo_admin_routes())
        // `layer` (not `route_layer`) because the guard must apply to ALL
        // nested routes including the merged sub-routers.
        .layer(from_fn_with_state(state, superadmin_guard))
}

/// Trivial health probe under `/admin/health`. Useful for smoke-testing the
/// guard alone without invoking any tenant/membership handler.
async fn admin_health() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}
