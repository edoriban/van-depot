use thiserror::Error;

/// Marker prefix used inside `DomainError::Conflict` messages to identify
/// protection errors for system-managed locations (e.g., Recepción). The API
/// layer parses this prefix to expose a structured `code` field on 409 bodies.
pub const SYSTEM_LOCATION_PROTECTED: &str = "SYSTEM_LOCATION_PROTECTED";

/// Machine-readable code emitted when a reclassification is blocked by
/// existing history (movements, lots, or tool_instances). The real carrier is
/// the typed `DomainError::ClassLocked` variant; this constant is kept so
/// callers that only need the code string can use it.
pub const PRODUCT_CLASS_LOCKED: &str = "PRODUCT_CLASS_LOCKED";

/// Marker prefix used inside `DomainError::Conflict` messages for attempts to
/// create a product_lot on a product whose class does not support lots
/// (tool_spare always, consumable without expiry).
pub const PRODUCT_CLASS_DOES_NOT_SUPPORT_LOTS: &str = "PRODUCT_CLASS_DOES_NOT_SUPPORT_LOTS";

/// Marker prefix for lot-creation attempts on a consumable product whose
/// has_expiry flag is false. Separate from the generic does-not-support-lots
/// code because the UI can offer to flip has_expiry instead.
pub const CONSUMABLE_REQUIRES_EXPIRY_FOR_LOT: &str = "CONSUMABLE_REQUIRES_EXPIRY_FOR_LOT";

/// Marker prefix emitted when tool_instances insert references a product
/// whose class is not tool_spare (and for analogous cross-class mismatches).
pub const PRODUCT_CLASS_MISMATCH: &str = "PRODUCT_CLASS_MISMATCH";

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
    /// Reclassify attempted on a product with existing history. Structured
    /// counts allow the API layer to emit a typed `blocked_by` JSON object
    /// instead of regex-parsing a message prefix.
    #[error("Product class is locked; cannot reclassify")]
    ClassLocked {
        movements: i64,
        lots: i64,
        tool_instances: i64,
    },
    /// Lot creation attempted for a product class that does not support lots
    /// (tool_spare always, consumable without expiry). Structured variant so
    /// the API layer can emit a stable `code` without string parsing.
    #[error("Product class does not support lots")]
    ProductClassDoesNotSupportLots,
}
