use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;

use crate::error::ApiError;

pub fn require_role(claims: &Claims, allowed_roles: &[&str]) -> Result<(), ApiError> {
    if allowed_roles.contains(&claims.role.as_str()) {
        Ok(())
    } else {
        Err(ApiError(DomainError::Forbidden(
            "Insufficient permissions".to_string(),
        )))
    }
}
