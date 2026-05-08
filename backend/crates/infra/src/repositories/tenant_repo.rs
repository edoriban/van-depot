//! Tenant repository — CRUD + slug-collision detection.
//!
//! Implements the data-access surface for the `tenants` table introduced in
//! migration `20260507000001_create_tenants.sql`. Functions are FREE FUNCTIONS
//! that take `&mut PgConnection`; this is the future-proof signature that
//! aligns with Phase C's `TenantTx` (see `sdd/multi-tenant-foundation/design`
//! §5.2 and §5.4 — repos move from struct-with-pool to executor-reference).
//!
//! Soft-deleted rows are excluded from every read path. `update`/`get_by_id`
//! treat soft-deleted IDs as not found.
//!
//! Error mapping (design §6 / §5.5):
//! - `23505` (unique_violation) on `slug` -> `DomainError::Conflict`.
//! - `23514` (check_violation) on slug format / reserved-word / status
//!   -> `DomainError::Validation` with the constraint name in the message.
//! - `RowNotFound` on `update` / re-`fetch_one` after soft-delete
//!   -> `DomainError::NotFound`.

use chrono::{DateTime, Utc};
use sqlx::Error as SqlxError;
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::tenant::{Tenant, TenantStatus};

/// Reserved slugs blocked at the application layer for friendlier error
/// messages. MUST be kept in sync with the DB CHECK constraint
/// `tenants_slug_reserved_chk` in
/// `20260507000001_create_tenants.sql`. The DB is the source of truth — this
/// helper is a fast-path filter that returns a precise validation error
/// before incurring a roundtrip.
const RESERVED_SLUGS: &[&str] = &[
    "admin", "api", "www", "app", "public", "system", "default", "health", "auth",
];

/// Returns true iff `slug` is on the reserved list.
///
/// Comparison is case-sensitive on `slug` because the DB CHECK is also
/// case-sensitive (the slug-format CHECK requires `^[a-z0-9]...`, so any
/// uppercase input would fail format validation before reaching the
/// reserved-word check).
pub fn is_reserved_slug(slug: &str) -> bool {
    RESERVED_SLUGS.iter().any(|r| *r == slug)
}

/// Internal row representation for sqlx `FromRow`.
#[derive(sqlx::FromRow)]
struct TenantRow {
    id: Uuid,
    slug: String,
    name: String,
    status: TenantStatus,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl From<TenantRow> for Tenant {
    fn from(row: TenantRow) -> Self {
        Tenant {
            id: row.id,
            slug: row.slug,
            name: row.name,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        }
    }
}

/// Maps a sqlx error coming out of a tenant-table mutation. Distinguishes
/// `23505` (slug uniqueness) from `23514` (CHECK violations: slug format,
/// reserved-word, or status) so the API layer can return 409 vs 422.
fn map_tenant_error(err: SqlxError) -> DomainError {
    if let SqlxError::Database(db_err) = &err {
        if let Some(code) = db_err.code() {
            return match code.as_ref() {
                "23505" => DomainError::Conflict(format!("tenant slug already exists: {}", db_err.message())),
                "23514" => DomainError::Validation(format!("tenant constraint violation: {}", db_err.message())),
                _ => DomainError::Internal(err.to_string()),
            };
        }
    }
    if matches!(err, SqlxError::RowNotFound) {
        return DomainError::NotFound("Tenant not found".to_string());
    }
    DomainError::Internal(err.to_string())
}

/// Inserts a new tenant and provisions per-tenant defaults (B8.3:
/// stock_configuration global row).
///
/// Returns `DomainError::Validation` if `slug` is on the reserved list
/// (short-circuited before the roundtrip), or if Postgres rejects the value
/// via a CHECK constraint (slug format / status). Returns
/// `DomainError::Conflict` on slug uniqueness collision.
///
/// Caller is expected to wrap this call in its own transaction so the
/// tenant insert and the default-row replication commit atomically. The
/// function takes `&mut PgConnection`; passing a `Transaction`'s deref is
/// the canonical pattern used by `/admin/tenants` POST.
pub async fn create(
    conn: &mut PgConnection,
    slug: &str,
    name: &str,
) -> Result<Tenant, DomainError> {
    if is_reserved_slug(slug) {
        return Err(DomainError::Validation(format!(
            "slug '{slug}' is reserved"
        )));
    }

    let row = sqlx::query_as::<_, TenantRow>(
        "INSERT INTO tenants (slug, name) \
         VALUES ($1, $2) \
         RETURNING id, slug, name, status, created_at, updated_at, deleted_at",
    )
    .bind(slug)
    .bind(name)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_tenant_error)?;

    // B8.3: replicate canonical stock_configuration defaults for this tenant.
    // Runs inside the caller's transaction so a failure rolls the tenant
    // insert back too.
    crate::seed::replicate_stock_config_for_tenant(&mut *conn, row.id).await?;

    Ok(Tenant::from(row))
}

/// Returns the tenant with the given id, or `None` if absent or
/// soft-deleted. Soft-deleted rows are invisible to consumers.
pub async fn get_by_id(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<Tenant>, DomainError> {
    let row = sqlx::query_as::<_, TenantRow>(
        "SELECT id, slug, name, status, created_at, updated_at, deleted_at \
         FROM tenants \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_tenant_error)?;

    Ok(row.map(Tenant::from))
}

/// Returns the tenant with the given slug, or `None` if absent or
/// soft-deleted.
pub async fn get_by_slug(
    conn: &mut PgConnection,
    slug: &str,
) -> Result<Option<Tenant>, DomainError> {
    let row = sqlx::query_as::<_, TenantRow>(
        "SELECT id, slug, name, status, created_at, updated_at, deleted_at \
         FROM tenants \
         WHERE slug = $1 AND deleted_at IS NULL",
    )
    .bind(slug)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_tenant_error)?;

    Ok(row.map(Tenant::from))
}

/// Lists live tenants ordered by creation time (descending).
///
/// `include_suspended = false` filters to active-only; `true` returns both
/// `active` and `suspended` (still excluding soft-deleted rows).
pub async fn list(
    conn: &mut PgConnection,
    include_suspended: bool,
) -> Result<Vec<Tenant>, DomainError> {
    let rows: Vec<TenantRow> = if include_suspended {
        sqlx::query_as::<_, TenantRow>(
            "SELECT id, slug, name, status, created_at, updated_at, deleted_at \
             FROM tenants \
             WHERE deleted_at IS NULL \
             ORDER BY created_at DESC",
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(map_tenant_error)?
    } else {
        sqlx::query_as::<_, TenantRow>(
            "SELECT id, slug, name, status, created_at, updated_at, deleted_at \
             FROM tenants \
             WHERE deleted_at IS NULL AND status = 'active' \
             ORDER BY created_at DESC",
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(map_tenant_error)?
    };

    Ok(rows.into_iter().map(Tenant::from).collect())
}

/// Partial-updates a tenant. Only fields with `Some(_)` are touched; all
/// others fall through `COALESCE`. Returns the updated row, or
/// `DomainError::NotFound` if the tenant is absent or soft-deleted.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    name: Option<&str>,
    status: Option<TenantStatus>,
) -> Result<Tenant, DomainError> {
    let row = sqlx::query_as::<_, TenantRow>(
        "UPDATE tenants SET \
            name = COALESCE($2, name), \
            status = COALESCE($3, status) \
         WHERE id = $1 AND deleted_at IS NULL \
         RETURNING id, slug, name, status, created_at, updated_at, deleted_at",
    )
    .bind(id)
    .bind(name)
    .bind(status.map(|s| s.as_str()))
    .fetch_one(&mut *conn)
    .await
    .map_err(map_tenant_error)?;

    Ok(Tenant::from(row))
}

/// Soft-deletes a tenant: sets `deleted_at = NOW()` AND
/// `status = 'suspended'`. Idempotent — re-deleting a soft-deleted row is a
/// no-op and still returns `Ok(())`.
pub async fn soft_delete(conn: &mut PgConnection, id: Uuid) -> Result<(), DomainError> {
    sqlx::query(
        "UPDATE tenants SET \
            deleted_at = COALESCE(deleted_at, NOW()), \
            status = 'suspended' \
         WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *conn)
    .await
    .map_err(map_tenant_error)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_slug_matches_db_list() {
        // These are the exact strings in
        // `tenants_slug_reserved_chk`. If the DB list ever changes, this
        // test should be updated in lock-step (and the migration too).
        for slug in [
            "admin", "api", "www", "app", "public", "system", "default", "health", "auth",
        ] {
            assert!(is_reserved_slug(slug), "expected '{slug}' to be reserved");
        }
    }

    #[test]
    fn non_reserved_slugs_pass() {
        for slug in ["acme", "globex", "vandev", "tenant-1", "abc123", "hello-world"] {
            assert!(
                !is_reserved_slug(slug),
                "expected '{slug}' to NOT be reserved"
            );
        }
    }

    #[test]
    fn reserved_slug_check_is_case_sensitive() {
        // The DB CHECK on slug format requires lowercase, so any uppercase
        // input would never reach the reserved-word check at all. Mirror
        // that behavior here: 'ADMIN' is NOT considered reserved by this
        // helper (the format check rejects it first).
        assert!(!is_reserved_slug("ADMIN"));
        assert!(!is_reserved_slug("Admin"));
    }
}

// Phase E coverage notes (integration testing for tenant_repo):
//   * create / get / list / update / soft_delete are exercised end-to-end via
//     the admin HTTP surface in `crates/api/tests/admin_seed_demo.rs` and
//     `crates/api/tests/multi_tenant_isolation.rs` (Phase E1/E2/E5 — every
//     test seeds 1-2 tenants through `seed_tenant_with_owner` which calls
//     this repo's `create` path indirectly via `with_bypass_session`).
//   * Cross-tenant SQL-layer isolation is asserted in
//     `crates/api/tests/rls_sql.rs` (Phase E4) — the `tenants` control-plane
//     table is verified RLS-EXEMPT there (it must remain readable on a fresh
//     connection so the membership lookup can run before session vars are
//     planted).
// A repo-only DB harness was deferred during planning because the higher-
// fidelity HTTP/SQL tests cover the same observable behavior with less
// duplication.
