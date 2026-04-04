use sqlx::Error as SqlxError;
use vandepot_domain::error::DomainError;

/// Maps sqlx database errors to domain errors.
///
/// Handles common PostgreSQL error codes:
/// - `23505` (unique_violation) → `DomainError::Duplicate`
/// - `23503` (foreign_key_violation) → `DomainError::Conflict`
pub fn map_sqlx_error(err: SqlxError) -> DomainError {
    match &err {
        SqlxError::RowNotFound => DomainError::NotFound("Entity not found".to_string()),
        SqlxError::Database(db_err) => {
            if let Some(code) = db_err.code() {
                match code.as_ref() {
                    "23505" => DomainError::Duplicate(db_err.message().to_string()),
                    "23503" => DomainError::Conflict(
                        "Cannot delete: referenced by other records".to_string(),
                    ),
                    _ => DomainError::Internal(err.to_string()),
                }
            } else {
                DomainError::Internal(err.to_string())
            }
        }
        _ => DomainError::Internal(err.to_string()),
    }
}
