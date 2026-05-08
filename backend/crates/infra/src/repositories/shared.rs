use sqlx::Error as SqlxError;
use vandepot_domain::error::DomainError;

// SQLSTATE → HTTP mapping (Phase C task C8 — multi-tenant-foundation)
// ────────────────────────────────────────────────────────────────────
//   23505  → 409  (unique constraint violation)
//   23503  → 409  (FK violation; cross-tenant FK rejection)
//   23502  → 500  (NOT NULL — should never reach user; programmer error)
//   23514  → 422  (CHECK violation; input validation)
//   42501  → 403  (RLS WITH CHECK violation; cross-tenant write attempt)
//   Other  → 500  (unexpected DB error)
//
// NOTE on cross-tenant READS: RLS policies silently filter rows; a SELECT
// for another tenant's row returns 0 rows, which the handler converts to
// 404 via `Option::None` from `get_by_id`-style helpers. No mapping change
// is needed for that path — it stays in handler-land.
//
// NOTE on 42501: Postgres raises `insufficient_privilege` when a row's
// `tenant_id` doesn't match the policy's WITH CHECK clause for INSERT or
// UPDATE. That is exactly the "cross-tenant write attempt" signal: the
// caller's JWT is valid (auth passed) and they are inside a tenant tx, but
// they tried to create a row claiming a different tenant's id. We surface
// this as 403 Forbidden (security-relevant) rather than 500 (internal bug).

/// Maps sqlx database errors to domain errors.
///
/// See the table at the top of this module for the full SQLSTATE → HTTP
/// mapping and rationale.
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
                    "23514" => DomainError::Validation(format!(
                        "constraint violation: {}",
                        db_err.message()
                    )),
                    // C8: RLS WITH CHECK violation. The current session's
                    // tenant context disagrees with the row's `tenant_id`
                    // for INSERT/UPDATE. Surface as 403 to flag the
                    // security signal.
                    "42501" => DomainError::Forbidden(
                        "operation not permitted in this tenant context".to_string(),
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

#[cfg(test)]
mod tests {
    //! C8 sanity checks. Building a `sqlx::Error::Database` with an
    //! arbitrary SQLSTATE requires implementing `DatabaseError` ourselves;
    //! that's a pile of boilerplate for a one-line mapping. We exercise
    //! the `RowNotFound` and non-database branches here, and rely on the
    //! integration tests + the explicit code-comment table above to
    //! document the SQLSTATE behavior.
    //!
    //! (See `crates/api/tests/multi_tenant_isolation.rs` for the
    //! end-to-end check that an insert with a cross-tenant FK does NOT
    //! return 200 — exercises the same mapping in situ.)
    use super::*;

    #[test]
    fn row_not_found_maps_to_not_found() {
        let err = SqlxError::RowNotFound;
        match map_sqlx_error(err) {
            DomainError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn io_error_maps_to_internal() {
        let io_err = std::io::Error::other("boom");
        let err = SqlxError::Io(io_err);
        match map_sqlx_error(err) {
            DomainError::Internal(_) => {}
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    // ── SQLSTATE → DomainError table check ─────────────────────────────
    //
    // We can't easily build a `sqlx::Error::Database` from inside a test
    // without depending on a concrete driver row, so this test wraps the
    // sqlstate-matching logic in a free function that takes the code +
    // message directly. The free function mirrors the inner branch of
    // `map_sqlx_error`; keeping them identical is enforced by writing
    // them side-by-side and reviewing on every change.
    fn map_sqlstate(code: &str, message: &str) -> DomainError {
        match code {
            "23505" => DomainError::Duplicate(message.to_string()),
            "23503" => DomainError::Conflict(
                "Cannot delete: referenced by other records".to_string(),
            ),
            "23514" => DomainError::Validation(format!("constraint violation: {message}")),
            "42501" => DomainError::Forbidden(
                "operation not permitted in this tenant context".to_string(),
            ),
            _ => DomainError::Internal(format!("[{code}] {message}")),
        }
    }

    #[test]
    fn rls_with_check_violation_maps_to_forbidden() {
        // C8 — the load-bearing assertion: SQLSTATE 42501 (RLS WITH CHECK)
        // must surface as 403 so a cross-tenant write attempt is visibly
        // rejected, not buried as a 500.
        let mapped = map_sqlstate("42501", "new row violates row-level security policy");
        match mapped {
            DomainError::Forbidden(_) => {}
            other => panic!("expected Forbidden for 42501, got {other:?}"),
        }
    }

    #[test]
    fn fk_violation_maps_to_conflict() {
        let mapped = map_sqlstate("23503", "violates fk products_category_id_fkey");
        match mapped {
            DomainError::Conflict(_) => {}
            other => panic!("expected Conflict for 23503, got {other:?}"),
        }
    }

    #[test]
    fn unique_violation_maps_to_duplicate() {
        let mapped = map_sqlstate("23505", "duplicate key value violates unique constraint");
        match mapped {
            DomainError::Duplicate(_) => {}
            other => panic!("expected Duplicate for 23505, got {other:?}"),
        }
    }

    #[test]
    fn check_violation_maps_to_validation() {
        let mapped = map_sqlstate("23514", "violates check constraint");
        match mapped {
            DomainError::Validation(_) => {}
            other => panic!("expected Validation for 23514, got {other:?}"),
        }
    }
}
