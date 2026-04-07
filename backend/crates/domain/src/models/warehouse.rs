use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Warehouse {
    pub id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub is_active: bool,
    pub canvas_width: Option<f32>,
    pub canvas_height: Option<f32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
