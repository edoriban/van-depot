use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::{ProductClass, UnitType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub id: Uuid,
    pub name: String,
    pub sku: String,
    pub description: Option<String>,
    pub category_id: Option<Uuid>,
    pub unit_of_measure: UnitType,
    pub product_class: ProductClass,
    pub has_expiry: bool,
    pub min_stock: f64,
    pub max_stock: Option<f64>,
    pub is_active: bool,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
