//! Role-based authorization guard.
//!
//! Source of truth: `sdd/multi-tenant-foundation/design` §7.
//!
//! `require_role` is the canonical predicate that operates on a resolved
//! [`TenantContext`]. Superadmin short-circuits to `Ok(())`; otherwise the
//! caller's `TenantRole` must be present in `allowed`.
//!
//! `require_role_claims` is a thin adapter for the legacy handler signature
//! that still passes `&Claims` directly. It lifts the claim into a
//! `TenantContext` (see [`tenant_context_from_claims`]) and delegates to
//! [`require_role`]. New code SHOULD prefer the canonical form once the
//! `Tenant` extractor lands in C2/C3.

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::{TenantContext, TenantRole};

use crate::error::ApiError;

use super::claims::tenant_context_from_claims;

/// Canonical role guard. Returns `Ok(())` when the caller is a superadmin or
/// when `ctx.role` is present in `allowed`. Otherwise emits a 403.
pub fn require_role(ctx: &TenantContext, allowed: &[TenantRole]) -> Result<(), ApiError> {
    if ctx.is_superadmin {
        return Ok(());
    }
    match ctx.role {
        Some(r) if allowed.contains(&r) => Ok(()),
        _ => Err(ApiError(DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        ))),
    }
}

/// Adapter for handlers that currently extract `Claims` directly.
///
/// Equivalent to `require_role(&tenant_context_from_claims(claims), allowed)`
/// but keeps the call sites short. Will be retired once every handler is
/// switched to the `Tenant(mut tx)` extractor (tasks C3/C4).
pub fn require_role_claims(claims: &Claims, allowed: &[TenantRole]) -> Result<(), ApiError> {
    require_role(&tenant_context_from_claims(claims), allowed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn ctx_with_role(role: Option<TenantRole>) -> TenantContext {
        TenantContext {
            user_id: Uuid::nil(),
            tenant_id: Some(Uuid::from_u128(1)),
            is_superadmin: false,
            role,
        }
    }

    fn superadmin_ctx() -> TenantContext {
        TenantContext {
            user_id: Uuid::nil(),
            tenant_id: None,
            is_superadmin: true,
            role: None,
        }
    }

    #[test]
    fn superadmin_always_allowed() {
        // Even with no `allowed` roles, the superadmin should pass.
        assert!(require_role(&superadmin_ctx(), &[]).is_ok());
        assert!(require_role(&superadmin_ctx(), &[TenantRole::Owner]).is_ok());
    }

    #[test]
    fn allowed_role_passes() {
        for role in [TenantRole::Owner, TenantRole::Manager, TenantRole::Operator] {
            assert!(
                require_role(&ctx_with_role(Some(role)), &[role]).is_ok(),
                "role {role:?} should be allowed when listed",
            );
        }
    }

    #[test]
    fn disallowed_role_denied() {
        assert!(matches!(
            require_role(&ctx_with_role(Some(TenantRole::Operator)), &[TenantRole::Owner]),
            Err(ApiError(DomainError::Forbidden(_)))
        ));
        assert!(matches!(
            require_role(
                &ctx_with_role(Some(TenantRole::Manager)),
                &[TenantRole::Owner]
            ),
            Err(ApiError(DomainError::Forbidden(_)))
        ));
    }

    #[test]
    fn missing_role_denied() {
        // Non-superadmin with no role (shouldn't normally happen, but the
        // guard must still refuse rather than panic).
        assert!(matches!(
            require_role(&ctx_with_role(None), &[TenantRole::Owner]),
            Err(ApiError(DomainError::Forbidden(_)))
        ));
    }

    #[test]
    fn empty_allow_list_only_admits_superadmin() {
        assert!(require_role(&superadmin_ctx(), &[]).is_ok());
        assert!(matches!(
            require_role(&ctx_with_role(Some(TenantRole::Owner)), &[]),
            Err(ApiError(DomainError::Forbidden(_)))
        ));
    }

    #[test]
    fn role_matrix_via_claims_adapter() {
        use vandepot_infra::auth::jwt::TokenKind;

        let mk = |is_super: bool, role: Option<TenantRole>| Claims {
            sub: Uuid::nil(),
            email: String::new(),
            tenant_id: if is_super { None } else { Some(Uuid::from_u128(1)) },
            is_superadmin: is_super,
            role,
            token_kind: TokenKind::Access,
            exp: 0,
            iat: 0,
        };

        // (is_super, role, allow, expect_ok)
        let cases = [
            (true, None, vec![], true),
            (true, None, vec![TenantRole::Owner], true),
            (false, Some(TenantRole::Owner), vec![TenantRole::Owner], true),
            (
                false,
                Some(TenantRole::Manager),
                vec![TenantRole::Owner, TenantRole::Manager],
                true,
            ),
            (false, Some(TenantRole::Operator), vec![TenantRole::Owner], false),
            (false, None, vec![TenantRole::Owner], false),
            (false, Some(TenantRole::Owner), vec![], false),
        ];

        for (is_super, role, allow, expect_ok) in cases {
            let claims = mk(is_super, role);
            let got = require_role_claims(&claims, &allow);
            assert_eq!(
                got.is_ok(),
                expect_ok,
                "is_super={is_super} role={role:?} allow={allow:?}",
            );
        }
    }
}
