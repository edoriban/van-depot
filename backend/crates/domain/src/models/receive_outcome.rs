use uuid::Uuid;

use super::product_lot::ProductLot;

/// Result of receiving inbound material.
///
/// Classic lot-backed receive (raw materials and consumables that track
/// expiry) returns `Lot`. Classes that do NOT support lots — `tool_spare`
/// always, and `consumable` when `has_expiry` is `false` — return
/// `DirectInventory` instead: the material still lands at the warehouse's
/// Recepción location, but no `product_lots` row is created and the
/// inventory/movement rows carry no `lot_id`.
///
/// Kept in the domain crate (not in `infra`) so API handlers and repository
/// call sites can import it without introducing a reverse dependency.
#[derive(Debug, Clone)]
pub enum ReceiveOutcome {
    /// Lot-backed receive (raw_material, or consumable+has_expiry=true).
    Lot(ProductLot),
    /// No-lot receive (tool_spare, or consumable+has_expiry=false).
    /// `inventory_id` is the affected `inventory` row (upserted at Recepción);
    /// `movement_id` is the `movements` row stamped for the entry; `quantity`
    /// is the good-qty portion landed at Recepción.
    DirectInventory {
        inventory_id: Uuid,
        movement_id: Uuid,
        product_id: Uuid,
        location_id: Uuid,
        quantity: f64,
    },
}
