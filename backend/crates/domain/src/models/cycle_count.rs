use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "cycle_count_status", rename_all = "snake_case")]
pub enum CycleCountStatus {
    Draft,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct CycleCount {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub warehouse_id: Uuid,
    pub name: String,
    pub status: CycleCountStatus,
    pub created_by: Uuid,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CycleCountItem {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub cycle_count_id: Uuid,
    pub product_id: Uuid,
    pub location_id: Uuid,
    pub system_quantity: f64,
    pub counted_quantity: Option<f64>,
    pub variance: Option<f64>,
    pub counted_by: Option<Uuid>,
    pub counted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    // Enriched fields (from JOINs)
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
    pub location_name: Option<String>,
}
