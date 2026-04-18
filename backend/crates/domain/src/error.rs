use thiserror::Error;

/// Marker prefix used inside `DomainError::Conflict` messages to identify
/// protection errors for system-managed locations (e.g., Recepción). The API
/// layer parses this prefix to expose a structured `code` field on 409 bodies.
pub const SYSTEM_LOCATION_PROTECTED: &str = "SYSTEM_LOCATION_PROTECTED";

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("Entity not found: {0}")]
    NotFound(String),
    #[error("Duplicate entity: {0}")]
    Duplicate(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Authentication failed: {0}")]
    AuthError(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Internal error: {0}")]
    Internal(String),
}
