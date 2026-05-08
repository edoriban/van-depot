//! Tenant context primitives shared by middleware, extractors, and repos.
//!
//! - [`TenantRole`] is the per-tenant authorization role, mapped 1:1 to the
//!   Postgres `tenant_role` enum (`owner | manager | operator`).
//! - [`TenantContext`] is the resolved per-request identity: who's calling,
//!   which tenant they're calling under (None = superadmin), and what role
//!   they hold within that tenant (None = superadmin).
//!
//! Source: `sdd/multi-tenant-foundation/design` §5.2.

use std::error::Error;
use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Per-tenant authorization role.
///
/// Maps to the Postgres `tenant_role` enum created in migration
/// `20260507000002_user_tenants_and_superadmin.sql`. The `rename_all =
/// "lowercase"` attribute makes SQLx serialize variants as the lowercase enum
/// labels (`owner`, `manager`, `operator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "tenant_role", rename_all = "lowercase")]
pub enum TenantRole {
    Owner,
    Manager,
    Operator,
}

impl fmt::Display for TenantRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            TenantRole::Owner => "owner",
            TenantRole::Manager => "manager",
            TenantRole::Operator => "operator",
        };
        f.write_str(s)
    }
}

/// Resolved per-request tenant identity.
///
/// `tenant_id` and `role` are `None` exclusively for superadmin tokens, which
/// bypass tenant-scoped policies. Non-superadmin requests MUST have both set
/// (the auth middleware rejects otherwise — see design §5.5).
#[derive(Debug, Clone)]
pub struct TenantContext {
    pub user_id: Uuid,
    pub tenant_id: Option<Uuid>,
    pub is_superadmin: bool,
    pub role: Option<TenantRole>,
}

impl TenantContext {
    /// Returns the active tenant id, or `MissingTenant` if the caller is a
    /// non-superadmin without an active tenant claim.
    pub fn require_tenant(&self) -> Result<Uuid, TenantContextError> {
        self.tenant_id.ok_or(TenantContextError::MissingTenant)
    }

    /// True iff the caller is the tenant owner (superadmin does NOT count —
    /// superadmin power flows through `is_superadmin`, not role).
    pub fn is_owner(&self) -> bool {
        matches!(self.role, Some(TenantRole::Owner))
    }
}

/// Errors raised by [`TenantContext`] helpers.
///
/// Kept local to this module for v1; can be unified into a global API/domain
/// error type in a later refactor (see design §5.5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantContextError {
    /// A non-superadmin caller had no active tenant claim.
    MissingTenant,
}

impl fmt::Display for TenantContextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TenantContextError::MissingTenant => {
                f.write_str("active tenant claim is required for this operation")
            }
        }
    }
}

impl Error for TenantContextError {}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: integration test that round-trips `TenantRole` through Postgres
    // via `query_as` is deferred to Phase E (full DB harness lives there).
    // For now we cover construction, helper logic, and (de)serialization.

    fn sample_user() -> Uuid {
        Uuid::nil()
    }

    fn sample_tenant() -> Uuid {
        Uuid::from_u128(0xDEAD_BEEF)
    }

    #[test]
    fn tenant_role_round_trips_through_serde_json() {
        let cases = [
            (TenantRole::Owner, "\"owner\""),
            (TenantRole::Manager, "\"manager\""),
            (TenantRole::Operator, "\"operator\""),
        ];
        for (role, json) in cases {
            let serialized = serde_json::to_string(&role).expect("serialize");
            assert_eq!(serialized, json);
            let parsed: TenantRole = serde_json::from_str(json).expect("deserialize");
            assert_eq!(parsed, role);
        }
    }

    #[test]
    fn tenant_role_display_matches_lowercase_label() {
        assert_eq!(TenantRole::Owner.to_string(), "owner");
        assert_eq!(TenantRole::Manager.to_string(), "manager");
        assert_eq!(TenantRole::Operator.to_string(), "operator");
    }

    #[test]
    fn require_tenant_succeeds_when_tenant_present() {
        let ctx = TenantContext {
            user_id: sample_user(),
            tenant_id: Some(sample_tenant()),
            is_superadmin: false,
            role: Some(TenantRole::Manager),
        };
        assert_eq!(ctx.require_tenant().unwrap(), sample_tenant());
    }

    #[test]
    fn require_tenant_errors_for_superadmin_without_tenant() {
        let ctx = TenantContext {
            user_id: sample_user(),
            tenant_id: None,
            is_superadmin: true,
            role: None,
        };
        assert_eq!(
            ctx.require_tenant().unwrap_err(),
            TenantContextError::MissingTenant
        );
    }

    #[test]
    fn is_owner_only_true_for_owner_role() {
        let mk = |role: Option<TenantRole>| TenantContext {
            user_id: sample_user(),
            tenant_id: Some(sample_tenant()),
            is_superadmin: false,
            role,
        };
        assert!(mk(Some(TenantRole::Owner)).is_owner());
        assert!(!mk(Some(TenantRole::Manager)).is_owner());
        assert!(!mk(Some(TenantRole::Operator)).is_owner());
        assert!(!mk(None).is_owner());
    }
}
