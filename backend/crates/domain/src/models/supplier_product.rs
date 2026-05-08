use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierProduct {
    pub id: Uuid,
    /// Owning tenant. Added in Phase B batch 3 (multi-tenant-foundation).
    /// The composite FKs `(tenant_id, supplier_id) → suppliers(tenant_id, id)`
    /// and `(tenant_id, product_id) → products(tenant_id, id)` guarantee
    /// `tenant_id` matches both parents at the DB layer.
    pub tenant_id: Uuid,
    pub supplier_id: Uuid,
    pub product_id: Uuid,
    pub supplier_sku: Option<String>,
    pub unit_cost: f64,
    pub lead_time_days: i32,
    pub minimum_order_qty: f64,
    pub is_preferred: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
