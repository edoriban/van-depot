//! `Tenant` extractor — the Phase C handler entry point.
//!
//! Source of truth: `sdd/multi-tenant-foundation/design` §5 (per-request
//! transaction owns RLS context).
//!
//! Pulls a [`TenantTx`] out of the request's extensions (planted there by
//! [`crate::middleware::tenant_tx::tenant_tx_middleware`]). Handlers receive
//! it by value and own the open transaction for the rest of the request.
//!
//! ## Handler contract
//!
//! ```ignore
//! async fn list_warehouses(
//!     Tenant(mut tt): Tenant,
//! ) -> Result<Json<...>, ApiError> {
//!     let tenant_id = tt.tenant_id()?;
//!     let rows = warehouse_repo::list(&mut *tt.tx, tenant_id, ..).await?;
//!     tt.commit().await.map_err(...)?;
//!     Ok(Json(...))
//! }
//! ```
//!
//! On success, the handler MUST call `tt.commit().await`. On error, dropping
//! the [`TenantTx`] rolls the tx back automatically.
//!
//! ## Why this rejects with 500
//!
//! The middleware always inserts a [`TenantTx`] BEFORE running the handler.
//! If the extractor sees `None`, it means the middleware was not mounted on
//! the route — that's a programmer error, not a client error, hence 500.

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use vandepot_infra::db::{TenantTx, TenantTxHandle};

use crate::state::AppState;

/// Extractor wrapper around the per-request [`TenantTx`].
pub struct Tenant(pub TenantTx);

impl FromRequestParts<AppState> for Tenant {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // The middleware stores a `TenantTxHandle` (Clone + Send + Sync) in
        // request extensions; we take the inner `TenantTx` out on the first
        // extract. Subsequent extractions of `Tenant` on the same request
        // return None — this is a wiring error, surfaced as 500.
        let handle = parts
            .extensions
            .get::<TenantTxHandle>()
            .ok_or_else(|| missing_middleware_response("tenant_tx middleware not mounted"))?
            .clone();

        let tt = handle
            .take()
            .ok_or_else(|| missing_middleware_response("Tenant extractor invoked twice in one request"))?;

        Ok(Tenant(tt))
    }
}

fn missing_middleware_response(msg: &'static str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": msg})),
    )
        .into_response()
}
