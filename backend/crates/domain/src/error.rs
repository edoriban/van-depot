use thiserror::Error;

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
    #[error("Internal error: {0}")]
    Internal(String),
}
