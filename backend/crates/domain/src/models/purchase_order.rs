use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::PurchaseOrderStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrder {
    pub id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_name: Option<String>,
    pub order_number: String,
    pub status: PurchaseOrderStatus,
    pub total_amount: Option<f64>,
    pub expected_delivery_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
