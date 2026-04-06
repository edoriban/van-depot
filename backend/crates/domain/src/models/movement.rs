use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::MovementType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Movement {
    pub id: Uuid,
    pub product_id: Uuid,
    pub from_location_id: Option<Uuid>,
    pub to_location_id: Option<Uuid>,
    pub quantity: f64,
    pub movement_type: MovementType,
    pub user_id: Uuid,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub movement_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}
