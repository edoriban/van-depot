use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockConfiguration {
    pub id: Uuid,
    pub warehouse_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub default_min_stock: f64,
    pub critical_stock_multiplier: f64,
    pub low_stock_multiplier: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
