use uuid::Uuid;
use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;

use crate::error::ApiError;

/// Ensures the authenticated user has access to the given warehouse.
///
/// Superadmin role bypasses warehouse scoping entirely.
pub fn ensure_warehouse_access(claims: &Claims, warehouse_id: &Uuid) -> Result<(), ApiError> {
    if claims.role.eq_ignore_ascii_case("superadmin") {
        return Ok(());
    }

    if claims.warehouse_ids.contains(warehouse_id) {
        Ok(())
    } else {
        Err(ApiError(DomainError::Forbidden(
            "Access denied to this warehouse".to_string(),
        )))
    }
}
