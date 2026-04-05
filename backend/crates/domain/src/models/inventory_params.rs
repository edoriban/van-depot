use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use super::enums::MovementType;

// ── Write operation params ──────────────────────────────────────────

pub struct EntryParams {
    pub product_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub user_id: Uuid,
    pub supplier_id: Option<Uuid>,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

pub struct ExitParams {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
    pub quantity: f64,
    pub user_id: Uuid,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

pub struct TransferParams {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
    pub user_id: Uuid,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

pub struct AdjustmentParams {
    pub product_id: Uuid,
    pub location_id: Uuid,
    pub new_quantity: f64,
    pub user_id: Uuid,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

// ── Query filters ───────────────────────────────────────────────────

pub struct MovementFilters {
    pub product_id: Option<Uuid>,
    /// Matches `from_location_id` OR `to_location_id`
    pub location_id: Option<Uuid>,
    pub movement_type: Option<MovementType>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
}

pub struct InventoryFilters {
    pub warehouse_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub low_stock: Option<bool>,
}

// ── Enriched read model (JOINed data) ───────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct InventoryItem {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_name: String,
    pub product_sku: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub warehouse_id: Uuid,
    pub quantity: f64,
    pub min_stock: f64,
}
