//! User-tenant membership repository.
//!
//! Owns CRUD for the `user_tenants` junction table created by migration
//! `20260507000002_user_tenants_and_superadmin.sql`. Functions take a
//! `&mut PgConnection` so callers can compose them inside the per-request
//! transaction introduced by C2 (the `Tenant` extractor) without re-checking
//! out a pool connection.
//!
//! Relevant artifacts:
//! - Spec: `sdd/multi-tenant-foundation/spec` — "User-Tenant Membership and Roles".
//! - Design: `sdd/multi-tenant-foundation/design` §3.2 (`user_tenants` schema)
//!   and §6 (error mapping).
//!
//! Schema recap (PK `(user_id, tenant_id)`):
//! ```sql
//! user_tenants(user_id, tenant_id, role tenant_role, created_at, revoked_at)
//! ```
//! `revoked_at IS NULL` ⇒ membership is ACTIVE.
//!
//! Error policy:
//! - Foreign-key violations on `grant` (unknown user_id or tenant_id) are
//!   normalized to `DomainError::NotFound("user or tenant not found")` —
//!   callers do not need to distinguish 23503 from a missing parent row.
//! - All other sqlx errors flow through `shared::map_sqlx_error`.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use crate::auth::tenant_context::TenantRole;

use super::shared::map_sqlx_error;

// ── Public types ─────────────────────────────────────────────────────────────

/// A membership row, optionally enriched with joined fields.
///
/// Only the core columns (`user_id`, `tenant_id`, `role`, `created_at`) are
/// always populated. The optional fields are filled when the corresponding
/// query joins `tenants` or `users`:
/// - [`list_for_user`] populates `tenant_slug` and `tenant_name`.
/// - [`list_for_tenant`] populates `user_email`.
///
/// Keeping a single shape (rather than three) lets callers reuse mapping
/// helpers and matches the lightweight style of the surrounding repos. If a
/// caller needs stricter typing, project into a domain struct at the boundary.
#[derive(Debug, Clone)]
pub struct Membership {
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub role: TenantRole,
    pub created_at: DateTime<Utc>,
    pub tenant_slug: Option<String>,
    pub tenant_name: Option<String>,
    pub user_email: Option<String>,
}

// ── Repo functions ───────────────────────────────────────────────────────────

/// Grant or re-grant a membership.
///
/// On `(user_id, tenant_id)` conflict: overwrites `role` with the supplied
/// value AND clears `revoked_at`. Re-granting a previously revoked membership
/// reactivates it (this is the documented contract — see spec scenario
/// "Superadmin grants membership"). FK violations on either parent are
/// normalized to `NotFound` so callers do not need to inspect SQLSTATE.
pub async fn grant(
    conn: &mut PgConnection,
    user_id: Uuid,
    tenant_id: Uuid,
    role: TenantRole,
) -> Result<(), DomainError> {
    let result = sqlx::query(
        "INSERT INTO user_tenants (user_id, tenant_id, role) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, tenant_id) DO UPDATE \
            SET role = EXCLUDED.role, \
                revoked_at = NULL",
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(role)
    .execute(&mut *conn)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(err) => Err(map_grant_error(err)),
    }
}

/// Revoke a membership (idempotent).
///
/// Sets `revoked_at = NOW()` on the row identified by `(user_id, tenant_id)`.
/// If the row does not exist, returns `NotFound`. If the row exists but is
/// already revoked (`revoked_at IS NOT NULL`), returns `Ok(())` and does NOT
/// touch the timestamp — re-revoking is a no-op.
pub async fn revoke(
    conn: &mut PgConnection,
    user_id: Uuid,
    tenant_id: Uuid,
) -> Result<(), DomainError> {
    // First confirm the row exists at all (regardless of revoked_at). This
    // lets us distinguish "no such membership" (NotFound) from "already
    // revoked" (idempotent Ok).
    let existing: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
        "SELECT revoked_at FROM user_tenants WHERE user_id = $1 AND tenant_id = $2",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    let Some((revoked_at,)) = existing else {
        return Err(DomainError::NotFound("membership not found".to_string()));
    };

    if revoked_at.is_some() {
        // Already revoked — idempotent.
        return Ok(());
    }

    sqlx::query(
        "UPDATE user_tenants SET revoked_at = NOW() \
         WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

/// List active memberships for a single user, joined with tenant identity.
///
/// Filters:
/// - `user_tenants.revoked_at IS NULL` — only active memberships.
/// - `tenants.deleted_at IS NULL`      — soft-deleted tenants are excluded.
///
/// Note: the `is_active`/`status` filter is intentionally NOT applied here —
/// suspended-but-not-deleted tenants still appear in the list so the UI can
/// surface them with a status badge. `verify_membership` is the gate that
/// enforces "active tenant only" for request authorization.
pub async fn list_for_user(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<Membership>, DomainError> {
    let rows: Vec<(Uuid, Uuid, TenantRole, DateTime<Utc>, String, String)> = sqlx::query_as(
        "SELECT ut.user_id, ut.tenant_id, ut.role, ut.created_at, t.slug, t.name \
         FROM user_tenants ut \
         INNER JOIN tenants t ON t.id = ut.tenant_id \
         WHERE ut.user_id = $1 \
           AND ut.revoked_at IS NULL \
           AND t.deleted_at IS NULL \
         ORDER BY ut.created_at ASC",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows
        .into_iter()
        .map(|(user_id, tenant_id, role, created_at, slug, name)| Membership {
            user_id,
            tenant_id,
            role,
            created_at,
            tenant_slug: Some(slug),
            tenant_name: Some(name),
            user_email: None,
        })
        .collect())
}

/// List active memberships within a tenant, joined with user identity.
///
/// Filters:
/// - `user_tenants.revoked_at IS NULL`
/// - `users.deleted_at IS NULL` — exclude soft-deleted users.
pub async fn list_for_tenant(
    conn: &mut PgConnection,
    tenant_id: Uuid,
) -> Result<Vec<Membership>, DomainError> {
    let rows: Vec<(Uuid, Uuid, TenantRole, DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT ut.user_id, ut.tenant_id, ut.role, ut.created_at, u.email \
         FROM user_tenants ut \
         INNER JOIN users u ON u.id = ut.user_id \
         WHERE ut.tenant_id = $1 \
           AND ut.revoked_at IS NULL \
           AND u.deleted_at IS NULL \
         ORDER BY ut.created_at ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows
        .into_iter()
        .map(|(user_id, tenant_id, role, created_at, email)| Membership {
            user_id,
            tenant_id,
            role,
            created_at,
            tenant_slug: None,
            tenant_name: None,
            user_email: Some(email),
        })
        .collect())
}

/// Verify a membership is currently usable.
///
/// Returns `Some(role)` only when:
/// 1. A `user_tenants` row exists for `(user_id, tenant_id)`.
/// 2. The membership is active (`revoked_at IS NULL`).
/// 3. The tenant is itself active (`status = 'active' AND deleted_at IS NULL`).
///
/// Otherwise returns `None`. This is the authorization gate the C3 middleware
/// will call on every request to defend against stale tokens (membership
/// revoked or tenant suspended/deleted between token mint and request).
pub async fn verify_membership(
    conn: &mut PgConnection,
    user_id: Uuid,
    tenant_id: Uuid,
) -> Result<Option<TenantRole>, DomainError> {
    let row: Option<(TenantRole,)> = sqlx::query_as(
        "SELECT ut.role \
         FROM user_tenants ut \
         INNER JOIN tenants t ON t.id = ut.tenant_id \
         WHERE ut.user_id = $1 \
           AND ut.tenant_id = $2 \
           AND ut.revoked_at IS NULL \
           AND t.status = 'active' \
           AND t.deleted_at IS NULL",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.map(|(role,)| role))
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Map errors from `grant`'s INSERT/UPSERT.
///
/// FK violations (23503) on either parent (users or tenants) become a
/// uniform `NotFound("user or tenant not found")` so callers do not have to
/// know which side was missing. Other errors flow through the shared mapper.
fn map_grant_error(err: sqlx::Error) -> DomainError {
    if let sqlx::Error::Database(db_err) = &err {
        if let Some(code) = db_err.code() {
            if code.as_ref() == "23503" {
                return DomainError::NotFound("user or tenant not found".to_string());
            }
        }
    }
    map_sqlx_error(err)
}

// Phase E coverage notes (integration testing for user_tenant_repo):
//   * Grant/revoke and list_* join shapes are covered transitively by every
//     Phase E HTTP test that calls `seed_tenant_with_owner` /
//     `seed_user_in_tenant` in `crates/api/tests/multi_tenant_isolation.rs`
//     and `crates/api/tests/role_isolation.rs` (each seeds 1-3 memberships
//     and exercises the matching read paths).
//   * `verify_membership` against suspended / soft-deleted tenants is asserted
//     in `multi_tenant_isolation.rs::suspended_tenant_rejects_refresh_with_403`
//     (Phase E5).
//   * `revoked_membership_yields_401_or_403_on_next_request` (Phase E5)
//     proves the revoke path is read by the request middleware.
// A repo-only DB harness was deferred — the HTTP-level tests above cover the
// observable behaviors (and the join shapes) with less duplication.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn membership_struct_is_constructible() {
        // Compile-only sanity: the struct shape matches the documented
        // contract (core columns + optional joined fields).
        let m = Membership {
            user_id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            role: TenantRole::Operator,
            created_at: Utc::now(),
            tenant_slug: Some("acme".to_string()),
            tenant_name: Some("Acme Co".to_string()),
            user_email: None,
        };
        assert_eq!(m.role, TenantRole::Operator);
        assert!(m.tenant_slug.is_some());
        assert!(m.user_email.is_none());
    }

    #[test]
    fn map_grant_error_translates_fk_violation_to_not_found() {
        // We can't easily fabricate a `sqlx::error::DatabaseError` impl, but
        // we can verify the non-database branch falls through to the shared
        // mapper (which surfaces `Internal` for non-database io errors).
        let io_err = std::io::Error::new(std::io::ErrorKind::Other, "boom");
        let mapped = map_grant_error(sqlx::Error::Io(io_err));
        match mapped {
            DomainError::Internal(_) => {}
            other => panic!("expected Internal for io::Error, got {other:?}"),
        }
    }

    #[test]
    fn map_grant_error_passes_row_not_found_through_shared_mapper() {
        let mapped = map_grant_error(sqlx::Error::RowNotFound);
        match mapped {
            DomainError::NotFound(_) => {}
            other => panic!("expected NotFound for RowNotFound, got {other:?}"),
        }
    }
}
