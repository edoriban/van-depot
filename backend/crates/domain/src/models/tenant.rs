//! Tenant domain model.
//!
//! Mirrors the `tenants` table introduced in migration
//! `20260507000001_create_tenants.sql`. The `status` column is TEXT with a
//! CHECK constraint (not a Postgres enum), so the Rust enum maps via a
//! string round-trip rather than `#[sqlx(type_name = ...)]` against a custom
//! type. See `sdd/multi-tenant-foundation/design` §3.1.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle status of a tenant.
///
/// Stored as TEXT in Postgres with a CHECK constraint
/// (`status IN ('active', 'suspended')`). Implements `sqlx::Type` against
/// `TEXT` with `rename_all = "lowercase"`, so SQLx can encode/decode the
/// variant directly when binding/reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "text", rename_all = "lowercase")]
pub enum TenantStatus {
    Active,
    Suspended,
}

impl TenantStatus {
    /// Lowercase wire label, matching the DB CHECK constraint values.
    pub fn as_str(&self) -> &'static str {
        match self {
            TenantStatus::Active => "active",
            TenantStatus::Suspended => "suspended",
        }
    }
}

impl std::fmt::Display for TenantStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Tenant root entity.
///
/// Soft-deleted rows (`deleted_at IS NOT NULL`) are filtered out by the repo
/// layer; consumers of `Tenant` should only ever see live rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub status: TenantStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_status_round_trips_through_serde_json() {
        let cases = [
            (TenantStatus::Active, "\"active\""),
            (TenantStatus::Suspended, "\"suspended\""),
        ];
        for (status, json) in cases {
            let serialized = serde_json::to_string(&status).expect("serialize");
            assert_eq!(serialized, json);
            let parsed: TenantStatus = serde_json::from_str(json).expect("deserialize");
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn tenant_status_as_str_matches_db_labels() {
        assert_eq!(TenantStatus::Active.as_str(), "active");
        assert_eq!(TenantStatus::Suspended.as_str(), "suspended");
    }
}
