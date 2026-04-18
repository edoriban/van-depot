use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::LocationType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: Uuid,
    pub warehouse_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub location_type: LocationType,
    pub name: String,
    pub label: Option<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub pos_x: Option<f32>,
    pub pos_y: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
