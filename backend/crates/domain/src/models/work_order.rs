use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::WorkOrderStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkOrder {
    pub id: Uuid,
    pub code: String,
    pub recipe_id: Uuid,
    pub fg_product_id: Uuid,
    pub fg_quantity: f64,
    pub status: WorkOrderStatus,
    pub warehouse_id: Uuid,
    pub work_center_location_id: Uuid,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub issued_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkOrderMaterial {
    pub id: Uuid,
    pub work_order_id: Uuid,
    pub product_id: Uuid,
    /// Populated via JOIN in list queries; `None` when loaded from a raw
    /// `work_order_materials` row without a product join.
    pub product_name: Option<String>,
    /// Populated via JOIN in list queries; `None` when loaded from a raw row.
    pub product_sku: Option<String>,
    pub quantity_expected: f64,
    pub quantity_consumed: f64,
    pub notes: Option<String>,
}
