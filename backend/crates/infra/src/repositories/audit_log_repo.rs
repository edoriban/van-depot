//! Audit log repository — append-only superadmin trail.
//!
//! Source of truth:
//! - Spec: `sdd/multi-tenant-foundation/spec` ("Superadmin Powers" — every
//!   impersonation MUST be recorded; user-locked decision: also every
//!   superadmin write to tenants/memberships).
//! - Design: `sdd/multi-tenant-foundation/design` §7 (audit log shape).
//! - Migration: `20260509000003_audit_log.sql`.
//!
//! The `audit_log` table is a control-plane table (no RLS). Writes happen
//! from `/admin/*` handlers which already run inside the per-request
//! transaction with `app.is_superadmin='true'` planted; we reuse that tx so
//! the audit row commits atomically with the action it records (a tenant
//! create rolling back also rolls the audit row back — that's the desired
//! behavior because the action did not actually happen).

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::PgConnection;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use super::shared::map_sqlx_error;

// ── Event names ──────────────────────────────────────────────────────────────

/// Canonical event-name constants.
///
/// Using a const set (not a Rust enum) keeps the surface small — handlers
/// write "the event name string" and queries filter on it. A future migration
/// to an enum can be done without changing the table shape.
pub mod events {
    pub const IMPERSONATION_MINTED: &str = "impersonation.minted";
    pub const TENANT_CREATED: &str = "tenant.created";
    pub const TENANT_UPDATED: &str = "tenant.updated";
    pub const TENANT_SUSPENDED: &str = "tenant.suspended";
    pub const TENANT_SEED_DEMO: &str = "tenant.seed_demo";
    pub const MEMBERSHIP_GRANTED: &str = "membership.granted";
    pub const MEMBERSHIP_REVOKED: &str = "membership.revoked";
}

// ── Public types ─────────────────────────────────────────────────────────────

/// Write-side payload for [`insert`].
///
/// `expires_at` and `source_ip` are optional — `expires_at` is only meaningful
/// for impersonation events (the moment the minted token stops being valid),
/// and `source_ip` is set when the caller happens to know it (we do not
/// presently extract `X-Forwarded-For` in tenant_tx middleware).
///
/// `source_ip` is carried as `Option<String>` and cast to Postgres `INET` at
/// query time. Doing the cast in SQL avoids pulling in the `ipnetwork` /
/// `ipnet` feature on the workspace's `sqlx` (only this column needs INET).
#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub actor_user_id: Uuid,
    pub event: String,
    pub target_tenant_id: Option<Uuid>,
    pub target_user_id: Option<Uuid>,
    pub metadata: Option<JsonValue>,
    pub expires_at: Option<DateTime<Utc>>,
    pub source_ip: Option<String>,
}

/// Read-side row shape returned by `list_*` helpers.
#[derive(Debug, Clone)]
pub struct AuditRow {
    pub id: Uuid,
    pub actor_user_id: Uuid,
    pub event: String,
    pub target_tenant_id: Option<Uuid>,
    pub target_user_id: Option<Uuid>,
    pub metadata: Option<JsonValue>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub source_ip: Option<String>,
}

// ── Repo functions ───────────────────────────────────────────────────────────

/// Append an audit row.
///
/// The caller is expected to pass the same `&mut PgConnection` (typically
/// `&mut *tt.tx`) that the surrounding admin action uses, so the audit row
/// shares the action's atomicity guarantee.
pub async fn insert(conn: &mut PgConnection, entry: AuditEntry) -> Result<(), DomainError> {
    // The cast `$7::inet` lets us bind `source_ip` as TEXT without enabling
    // sqlx's `ipnetwork` / `ipnet` feature for one column. Postgres parses
    // the string at insert time; an invalid IP raises 22P02 → 422.
    sqlx::query(
        "INSERT INTO audit_log \
            (actor_user_id, event, target_tenant_id, target_user_id, \
             metadata, expires_at, source_ip) \
         VALUES ($1, $2, $3, $4, $5, $6, $7::inet)",
    )
    .bind(entry.actor_user_id)
    .bind(&entry.event)
    .bind(entry.target_tenant_id)
    .bind(entry.target_user_id)
    .bind(&entry.metadata)
    .bind(entry.expires_at)
    .bind(&entry.source_ip)
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

/// List the most recent `limit` rows for a given actor (newest first).
///
/// Backed by `idx_audit_log_actor`. The cap is the caller's responsibility —
/// passing a huge `limit` returns a huge result.
pub async fn list_for_actor(
    conn: &mut PgConnection,
    actor_id: Uuid,
    limit: i64,
) -> Result<Vec<AuditRow>, DomainError> {
    // host(source_ip) returns the address as text (e.g. "192.0.2.7"); cast
    // to TEXT keeps sqlx happy without an ip-net dependency. NULL passes
    // through.
    let rows: Vec<AuditRow> = sqlx::query_as::<_, AuditRowSqlx>(
        "SELECT id, actor_user_id, event, target_tenant_id, target_user_id, \
                metadata, issued_at, expires_at, host(source_ip)::text AS source_ip \
         FROM audit_log \
         WHERE actor_user_id = $1 \
         ORDER BY issued_at DESC \
         LIMIT $2",
    )
    .bind(actor_id)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .into_iter()
    .map(AuditRow::from)
    .collect();
    Ok(rows)
}

/// List the most recent `limit` rows that target a given tenant (newest
/// first). Backed by `idx_audit_log_target_tenant`.
pub async fn list_for_tenant(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    limit: i64,
) -> Result<Vec<AuditRow>, DomainError> {
    let rows: Vec<AuditRow> = sqlx::query_as::<_, AuditRowSqlx>(
        "SELECT id, actor_user_id, event, target_tenant_id, target_user_id, \
                metadata, issued_at, expires_at, host(source_ip)::text AS source_ip \
         FROM audit_log \
         WHERE target_tenant_id = $1 \
         ORDER BY issued_at DESC \
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(map_sqlx_error)?
    .into_iter()
    .map(AuditRow::from)
    .collect();
    Ok(rows)
}

// ── Internal sqlx row shape ──────────────────────────────────────────────────

/// Internal sqlx FromRow shape — kept private so the public `AuditRow` API is
/// not coupled to sqlx attributes.
#[derive(sqlx::FromRow)]
struct AuditRowSqlx {
    id: Uuid,
    actor_user_id: Uuid,
    event: String,
    target_tenant_id: Option<Uuid>,
    target_user_id: Option<Uuid>,
    metadata: Option<JsonValue>,
    issued_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    source_ip: Option<String>,
}

impl From<AuditRowSqlx> for AuditRow {
    fn from(row: AuditRowSqlx) -> Self {
        AuditRow {
            id: row.id,
            actor_user_id: row.actor_user_id,
            event: row.event,
            target_tenant_id: row.target_tenant_id,
            target_user_id: row.target_user_id,
            metadata: row.metadata,
            issued_at: row.issued_at,
            expires_at: row.expires_at,
            source_ip: row.source_ip,
        }
    }
}

#[cfg(test)]
mod tests {
    //! Compile-only and shape sanity. End-to-end DB roundtrips for
    //! `insert`/`list_*` are exercised in the C7 integration test
    //! (`backend/crates/api/tests/`) and the Phase E DB harness.

    use super::*;

    #[test]
    fn audit_entry_round_trips_metadata_json() {
        // Sanity: serde_json::Value carries through the AuditEntry struct
        // unchanged. Useful for confirming the type plumbing compiles for
        // both Some(...) and None.
        let with_meta = AuditEntry {
            actor_user_id: Uuid::nil(),
            event: events::IMPERSONATION_MINTED.to_string(),
            target_tenant_id: Some(Uuid::nil()),
            target_user_id: None,
            metadata: Some(serde_json::json!({"ttl_minutes": 15})),
            expires_at: Some(Utc::now()),
            source_ip: None,
        };
        assert_eq!(with_meta.event, "impersonation.minted");
        assert_eq!(
            with_meta.metadata.as_ref().and_then(|v| v.get("ttl_minutes").and_then(|n| n.as_i64())),
            Some(15)
        );

        let no_meta = AuditEntry {
            actor_user_id: Uuid::nil(),
            event: events::TENANT_CREATED.to_string(),
            target_tenant_id: Some(Uuid::nil()),
            target_user_id: None,
            metadata: None,
            expires_at: None,
            source_ip: None,
        };
        assert!(no_meta.metadata.is_none());
    }

    #[test]
    fn event_constants_match_documented_strings() {
        // These strings appear in the spec / design and in any external
        // dashboard that filters audit_log; locking them down against
        // accidental rename.
        assert_eq!(events::IMPERSONATION_MINTED, "impersonation.minted");
        assert_eq!(events::TENANT_CREATED, "tenant.created");
        assert_eq!(events::TENANT_UPDATED, "tenant.updated");
        assert_eq!(events::TENANT_SUSPENDED, "tenant.suspended");
        assert_eq!(events::TENANT_SEED_DEMO, "tenant.seed_demo");
        assert_eq!(events::MEMBERSHIP_GRANTED, "membership.granted");
        assert_eq!(events::MEMBERSHIP_REVOKED, "membership.revoked");
    }
}
