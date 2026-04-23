use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::models::enums::WorkOrderStatus;

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

// ── Work-orders-and-bom string codes (design §5d) ────────────────────────

/// Emitted when `POST /work-orders/{id}/complete` finds any material short at
/// the work-center. The companion JSON body includes a `missing` list.
pub const INSUFFICIENT_WORK_ORDER_STOCK: &str = "INSUFFICIENT_WORK_ORDER_STOCK";

/// Emitted when a WO state-transition endpoint is invoked from an illegal
/// current state (e.g. `issue` from `completed`).
pub const WORK_ORDER_INVALID_TRANSITION: &str = "WORK_ORDER_INVALID_TRANSITION";

/// Emitted at WO creation when the referenced recipe contains any item whose
/// product has `product_class = 'tool_spare'`.
pub const WORK_ORDER_BOM_INCLUDES_TOOL_SPARE: &str = "WORK_ORDER_BOM_INCLUDES_TOOL_SPARE";

/// Emitted at WO creation when the target warehouse has zero `work_center`
/// locations.
pub const WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER: &str = "WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER";

/// Emitted at WO creation when the chosen finished-good product does not have
/// `is_manufactured = true`.
pub const WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED: &str = "WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED";

/// Emitted when a recipe item references a product with
/// `product_class = 'tool_spare'`. Belt-and-suspenders with the WO-creation
/// guard above.
pub const RECIPE_ITEM_REJECTS_TOOL_SPARE: &str = "RECIPE_ITEM_REJECTS_TOOL_SPARE";

/// Emitted when a product cross-field invariant is violated:
/// `is_manufactured = true` requires `product_class = 'raw_material'`.
pub const PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL: &str =
    "PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL";

/// Structured payload attached to [`DomainError::InsufficientWorkOrderStock`].
/// One entry per material line that fell short at back-flush time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingMaterial {
    pub product_id: Uuid,
    pub expected: f64,
    pub available: f64,
    pub shortfall: f64,
}

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

    // ── Work-orders-and-bom variants (design §5d) ─────────────────────────
    /// Back-flush consumption at WO complete found one or more materials with
    /// insufficient stock at the work-center location. The `missing` list has
    /// one entry per material line that fell short; zero rows MUST be written
    /// when this variant is returned.
    #[error("Insufficient stock to complete work order")]
    InsufficientWorkOrderStock { missing: Vec<MissingMaterial> },
    /// WO state-transition attempted from an illegal current state.
    #[error("Work order state transition invalid: {from:?} -> {to:?}")]
    WorkOrderInvalidTransition {
        from: WorkOrderStatus,
        to: WorkOrderStatus,
    },
    /// WO creation rejected: the referenced recipe contains at least one item
    /// whose product has `product_class = 'tool_spare'`.
    #[error("Recipe contains tool_spare items; work order cannot be created")]
    WorkOrderBomIncludesToolSpare {
        offending_product_ids: Vec<Uuid>,
    },
    /// WO creation rejected: the target warehouse has zero `work_center`
    /// locations.
    #[error("Warehouse has no work_center location")]
    WorkOrderWarehouseHasNoWorkCenter { warehouse_id: Uuid },
    /// WO creation rejected: the FG product is not marked `is_manufactured = true`.
    #[error("Finished-good product is not marked as manufactured")]
    WorkOrderFgProductNotManufactured { product_id: Uuid },
    /// Recipe-item insert rejected: referenced product has
    /// `product_class = 'tool_spare'`.
    #[error("Recipe item cannot reference a tool_spare product")]
    RecipeItemRejectsToolSpare { product_id: Uuid },
    /// Product cross-field invariant violated: `is_manufactured = true`
    /// requires `product_class = 'raw_material'`.
    #[error("is_manufactured=true requires product_class=raw_material")]
    ProductIsManufacturedRequiresRawMaterial { product_id: Uuid },
}
