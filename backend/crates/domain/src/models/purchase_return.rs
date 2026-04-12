use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::{PurchaseReturnReason, PurchaseReturnStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReturn {
    pub id: Uuid,
    pub purchase_order_id: Uuid,
    pub return_number: String,
    pub status: PurchaseReturnStatus,
    pub reason: PurchaseReturnReason,
    pub reason_notes: Option<String>,
    pub subtotal: f64,
    pub total: f64,
    pub refund_amount: Option<f64>,
    pub decrease_inventory: bool,
    pub requested_by_id: Uuid,
    pub shipped_at: Option<DateTime<Utc>>,
    pub refunded_at: Option<DateTime<Utc>>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReturnItem {
    pub id: Uuid,
    pub purchase_return_id: Uuid,
    pub product_id: Uuid,
    pub quantity_returned: f64,
    pub quantity_original: f64,
    pub unit_price: f64,
    pub subtotal: f64,
}
