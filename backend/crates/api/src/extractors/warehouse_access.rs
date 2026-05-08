//! Warehouse-scoped access guard.
//!
//! Phase C task C4 (multi-tenant-foundation, design §5.4) updated this helper
//! to take `&mut PgConnection` instead of `&PgPool`. The connection passed in
//! is the per-request transaction (planted by `tenant_tx_middleware`); the
//! check therefore happens INSIDE the request's RLS context.
//!
//! Phase B history (still relevant):
//!   * After A5, the JWT no longer carries `warehouse_ids`.
//!   * After B1, this guard resolves the warehouse via tenant-scoped
//!     `warehouse_repo::find_by_id`.
//!   * After B8.1, `user_warehouses` carries `tenant_id` natively, so the
//!     membership check goes through `user_warehouse_repo::is_assigned`
//!     with the active tenant_id explicit.
//!
//! Superadmin bypass: if `claims.is_superadmin`, both checks are skipped.
//! Superadmin tokens DO NOT carry a `tenant_id`; this guard returning
//! `Ok(())` is the correct behavior — the superadmin's authority is global.

use sqlx::PgConnection;
use uuid::Uuid;
use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::TenantContext;
use vandepot_infra::repositories::{user_warehouse_repo, warehouse_repo};

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;

/// Returns `Ok(())` when the caller has access to `warehouse_id` within their
/// active tenant. Returns 403 when the warehouse does not exist in that
/// tenant (cross-tenant probes are forbidden), or when the user is not
/// assigned to that warehouse.
///
/// Returns 401 (`AuthError`) for non-superadmin callers without a tenant
/// claim (stale token).
///
/// Superadmin tokens bypass both checks entirely.
pub async fn ensure_warehouse_access(
    conn: &mut PgConnection,
    claims: &Claims,
    warehouse_id: &Uuid,
) -> Result<(), ApiError> {
    let ctx = tenant_context_from_claims(claims);
    if ctx.is_superadmin {
        return Ok(());
    }

    let tenant_id = require_tenant(&ctx)?;

    // Step 1: confirm the warehouse exists in this tenant. A cross-tenant
    // probe surfaces as `Forbidden` rather than `NotFound` — the caller is
    // attempting to access another tenant's resource, even if the UUID is
    // otherwise valid.
    let exists = warehouse_repo::find_by_id(&mut *conn, tenant_id, *warehouse_id).await?;
    if exists.is_none() {
        return Err(ApiError(DomainError::Forbidden(
            "Access denied to this warehouse".to_string(),
        )));
    }

    // Step 2: tenant-scoped membership check. Post-B8.1, `user_warehouses`
    // carries tenant_id natively and the composite FK to `user_tenants`
    // means a row only exists if the user is also a member of the tenant.
    let allowed = user_warehouse_repo::is_assigned(
        &mut *conn,
        tenant_id,
        claims.sub,
        *warehouse_id,
    )
    .await?;

    if allowed {
        Ok(())
    } else {
        Err(ApiError(DomainError::Forbidden(
            "Access denied to this warehouse".to_string(),
        )))
    }
}

/// Convenience helper that returns the active warehouse ids for the caller
/// in their tenant.
///
/// Returns `None` for superadmin (used by handlers that interpret `None` as
/// "no scoping filter"). For tenant users, returns `Some(ids)` from
/// `user_warehouses` already scoped to the active tenant via the
/// `(tenant_id, user_id)` predicate. Post-B8.1 every `user_warehouses` row
/// carries `tenant_id` and the composite FK to warehouses guarantees the
/// returned warehouse_ids actually exist in the tenant — no extra
/// intersection query needed.
pub async fn warehouse_scope(
    conn: &mut PgConnection,
    claims: &Claims,
) -> Result<Option<Vec<Uuid>>, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    if ctx.is_superadmin {
        return Ok(None);
    }

    let tenant_id = require_tenant(&ctx)?;

    let ids = user_warehouse_repo::list_for_user(&mut *conn, tenant_id, claims.sub).await?;
    Ok(Some(ids))
}

fn require_tenant(ctx: &TenantContext) -> Result<Uuid, ApiError> {
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::AuthError(
            "tenant_id required (stale or non-tenant token)".to_string(),
        ))
    })
}
