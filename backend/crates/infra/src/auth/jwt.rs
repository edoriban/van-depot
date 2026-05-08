//! JWT encoder/decoder for the multi-tenant token shape.
//!
//! Source of truth: `sdd/multi-tenant-foundation/design` §6.
//!
//! The `Claims` payload carries:
//! - `sub`: user UUID (always present),
//! - `email`: convenience copy for logging/UX,
//! - `tenant_id`: `Some(uuid)` for tenant-scoped tokens, `None` for superadmin
//!   or pre-selection (intermediate) tokens,
//! - `is_superadmin`: bypass flag (mirrored from `users.is_superadmin`),
//! - `role`: `Some(TenantRole)` for tenant-scoped tokens, `None` for
//!   superadmin or intermediate tokens,
//! - `token_kind`: `Access | Refresh | Intermediate` (serialized lowercase),
//! - `exp`/`iat`: standard JWT timestamps.
//!
//! The legacy `warehouse_ids` and `role: String` fields are GONE — warehouse
//! access is now derived per-request from `user_warehouses` and the active
//! tenant.

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::tenant_context::TenantRole;

/// Token kind discriminator, serialized as a lowercase string.
///
/// `Access` and `Refresh` are the conventional pair.
/// `Intermediate` is the short-lived (≤60s) token minted by the first leg of
/// the two-step login (A12) — it carries `sub` only and is exchanged at
/// `/auth/select-tenant` for a final `Access` token bound to a tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenKind {
    Access,
    Refresh,
    Intermediate,
}

/// Multi-tenant JWT claims payload.
///
/// All non-superadmin authenticated requests MUST carry `tenant_id = Some(_)`
/// and `role = Some(_)`. Superadmin tokens have both as `None` and rely on
/// `is_superadmin = true` for authorization. Intermediate tokens (two-step
/// login) also have both as `None` but `is_superadmin = false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub email: String,
    #[serde(default)]
    pub tenant_id: Option<Uuid>,
    #[serde(default)]
    pub is_superadmin: bool,
    #[serde(default)]
    pub role: Option<TenantRole>,
    pub token_kind: TokenKind,
    pub exp: i64,
    pub iat: i64,
}

impl Claims {
    /// Returns true iff the caller has the given `tenant_role` *or* is a
    /// superadmin (which short-circuits role checks per design §7).
    pub fn has_any_role(&self, allowed: &[TenantRole]) -> bool {
        if self.is_superadmin {
            return true;
        }
        match self.role {
            Some(r) => allowed.contains(&r),
            None => false,
        }
    }
}

#[derive(Clone)]
pub struct JwtConfig {
    pub secret: String,
    pub access_expiration: i64,
    pub refresh_expiration: i64,
    /// TTL for the two-step-login intermediate token. Defaults to 60 seconds.
    pub intermediate_expiration: i64,
}

impl JwtConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            secret: std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?,
            access_expiration: std::env::var("JWT_ACCESS_EXPIRATION")
                .unwrap_or_else(|_| "900".to_string())
                .parse()
                .context("JWT_ACCESS_EXPIRATION must be a number")?,
            refresh_expiration: std::env::var("JWT_REFRESH_EXPIRATION")
                .unwrap_or_else(|_| "604800".to_string())
                .parse()
                .context("JWT_REFRESH_EXPIRATION must be a number")?,
            intermediate_expiration: std::env::var("JWT_INTERMEDIATE_EXPIRATION")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .context("JWT_INTERMEDIATE_EXPIRATION must be a number")?,
        })
    }
}

/// Mints an Access token for a tenant-scoped session.
///
/// `tenant_id` and `role` are `None` for superadmin tokens; both must be
/// `Some(_)` for normal users (caller responsibility — not enforced here).
pub fn create_access_token(
    config: &JwtConfig,
    user_id: Uuid,
    email: &str,
    tenant_id: Option<Uuid>,
    is_superadmin: bool,
    role: Option<TenantRole>,
) -> Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        tenant_id,
        is_superadmin,
        role,
        token_kind: TokenKind::Access,
        exp: (now + Duration::seconds(config.access_expiration)).timestamp(),
        iat: now.timestamp(),
    };
    encode_claims(config, &claims).context("Failed to create access token")
}

/// Mints a Refresh token. Refresh tokens MUST preserve the same `tenant_id`
/// as the access token they were paired with (design §6.3) — `None` for
/// superadmin sessions.
pub fn create_refresh_token(
    config: &JwtConfig,
    user_id: Uuid,
    email: &str,
    tenant_id: Option<Uuid>,
    is_superadmin: bool,
    role: Option<TenantRole>,
) -> Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        tenant_id,
        is_superadmin,
        role,
        token_kind: TokenKind::Refresh,
        exp: (now + Duration::seconds(config.refresh_expiration)).timestamp(),
        iat: now.timestamp(),
    };
    encode_claims(config, &claims).context("Failed to create refresh token")
}

/// Mints an Intermediate token used by the two-step login flow (A12).
///
/// Intermediate tokens only authorize `POST /auth/select-tenant`; they do
/// NOT carry `tenant_id`/`role` and live for `intermediate_expiration`
/// seconds (defaults to 60).
pub fn create_intermediate_token(
    config: &JwtConfig,
    user_id: Uuid,
    email: &str,
) -> Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        tenant_id: None,
        is_superadmin: false,
        role: None,
        token_kind: TokenKind::Intermediate,
        exp: (now + Duration::seconds(config.intermediate_expiration)).timestamp(),
        iat: now.timestamp(),
    };
    encode_claims(config, &claims).context("Failed to create intermediate token")
}

fn encode_claims(config: &JwtConfig, claims: &Claims) -> jsonwebtoken::errors::Result<String> {
    encode(
        &Header::default(),
        claims,
        &EncodingKey::from_secret(config.secret.as_bytes()),
    )
}

/// Decodes and validates a JWT against the configured secret. Returns the
/// `Claims` payload on success. Caller is responsible for inspecting
/// `token_kind` to enforce route-specific kind checks (e.g.,
/// `/auth/select-tenant` only accepts `Intermediate`).
pub fn validate_token(config: &JwtConfig, token: &str) -> Result<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.secret.as_bytes()),
        &Validation::default(),
    )
    .context("Invalid or expired token")?;
    Ok(token_data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> JwtConfig {
        JwtConfig {
            secret: "test-secret-with-enough-bytes".to_string(),
            access_expiration: 900,
            refresh_expiration: 604_800,
            intermediate_expiration: 60,
        }
    }

    #[test]
    fn access_token_round_trips_with_tenant_role() {
        let user = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let token = create_access_token(
            &cfg(),
            user,
            "u@x.com",
            Some(tenant),
            false,
            Some(TenantRole::Manager),
        )
        .expect("encode");

        let decoded = validate_token(&cfg(), &token).expect("decode");
        assert_eq!(decoded.sub, user);
        assert_eq!(decoded.email, "u@x.com");
        assert_eq!(decoded.tenant_id, Some(tenant));
        assert!(!decoded.is_superadmin);
        assert_eq!(decoded.role, Some(TenantRole::Manager));
        assert_eq!(decoded.token_kind, TokenKind::Access);
    }

    #[test]
    fn refresh_token_round_trips() {
        let user = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let token = create_refresh_token(
            &cfg(),
            user,
            "u@x.com",
            Some(tenant),
            false,
            Some(TenantRole::Owner),
        )
        .expect("encode");

        let decoded = validate_token(&cfg(), &token).expect("decode");
        assert_eq!(decoded.token_kind, TokenKind::Refresh);
        assert_eq!(decoded.role, Some(TenantRole::Owner));
        assert_eq!(decoded.tenant_id, Some(tenant));
    }

    #[test]
    fn intermediate_token_round_trips_with_no_tenant() {
        let user = Uuid::new_v4();
        let token = create_intermediate_token(&cfg(), user, "u@x.com").expect("encode");

        let decoded = validate_token(&cfg(), &token).expect("decode");
        assert_eq!(decoded.token_kind, TokenKind::Intermediate);
        assert_eq!(decoded.tenant_id, None);
        assert_eq!(decoded.role, None);
        assert!(!decoded.is_superadmin);
    }

    #[test]
    fn superadmin_token_round_trips_with_no_tenant_no_role() {
        let user = Uuid::new_v4();
        let token =
            create_access_token(&cfg(), user, "admin@x.com", None, true, None).expect("encode");

        let decoded = validate_token(&cfg(), &token).expect("decode");
        assert!(decoded.is_superadmin);
        assert_eq!(decoded.tenant_id, None);
        assert_eq!(decoded.role, None);
        assert_eq!(decoded.token_kind, TokenKind::Access);
    }

    #[test]
    fn token_kind_serializes_as_lowercase() {
        assert_eq!(serde_json::to_string(&TokenKind::Access).unwrap(), "\"access\"");
        assert_eq!(
            serde_json::to_string(&TokenKind::Refresh).unwrap(),
            "\"refresh\""
        );
        assert_eq!(
            serde_json::to_string(&TokenKind::Intermediate).unwrap(),
            "\"intermediate\""
        );
    }

    #[test]
    fn has_any_role_short_circuits_for_superadmin() {
        let claims = Claims {
            sub: Uuid::new_v4(),
            email: String::new(),
            tenant_id: None,
            is_superadmin: true,
            role: None,
            token_kind: TokenKind::Access,
            exp: 0,
            iat: 0,
        };
        assert!(claims.has_any_role(&[TenantRole::Operator]));
        assert!(claims.has_any_role(&[]));
    }

    #[test]
    fn has_any_role_matches_role() {
        let mk = |role: Option<TenantRole>| Claims {
            sub: Uuid::new_v4(),
            email: String::new(),
            tenant_id: Some(Uuid::new_v4()),
            is_superadmin: false,
            role,
            token_kind: TokenKind::Access,
            exp: 0,
            iat: 0,
        };
        assert!(mk(Some(TenantRole::Owner)).has_any_role(&[TenantRole::Owner]));
        assert!(!mk(Some(TenantRole::Operator)).has_any_role(&[TenantRole::Owner]));
        assert!(!mk(None).has_any_role(&[TenantRole::Owner]));
    }
}
