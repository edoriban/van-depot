use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enums::WorkOrderStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkOrder {
    pub id: Uuid,
    /// Phase B B5 — tenant ownership column. NOT NULL since
    /// 20260508000005_tenant_id_recipes_work_orders.
    pub tenant_id: Uuid,
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

#[cfg(test)]
mod tests {
    //! Task 6.1 — domain-level tests for the work-order model.
    //!
    //! Serde + transition-matrix coverage lives in `enums.rs`; this file
    //! covers struct-level invariants for `WorkOrder` and `WorkOrderMaterial`
    //! (round-trip, default-shaped quantities, optional lifecycle stamps).
    //!
    //! The cross-field product invariant (`is_manufactured=true` requires
    //! `product_class=raw_material`) is enforced in the repo layer (see
    //! `product_repo::create_product` + `update_product` +
    //! `reclassify_product`). The API integration tests in
    //! `backend/crates/api/tests/work_orders.rs` (6.4 / 6.16) exercise that
    //! path end-to-end — no runtime rejection exists at the struct level, so
    //! no domain-level test is added here. This is an intentional test-split.
    use super::*;
    use crate::models::enums::WorkOrderStatus;
    use chrono::TimeZone;

    fn sample_wo() -> WorkOrder {
        WorkOrder {
            id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            code: "WO-20260423-ABCDEF".to_string(),
            recipe_id: Uuid::nil(),
            fg_product_id: Uuid::nil(),
            fg_quantity: 1.0,
            status: WorkOrderStatus::Draft,
            warehouse_id: Uuid::nil(),
            work_center_location_id: Uuid::nil(),
            notes: None,
            created_by: Uuid::nil(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 23, 10, 0, 0).unwrap(),
            issued_at: None,
            completed_at: None,
            cancelled_at: None,
            updated_at: Utc.with_ymd_and_hms(2026, 4, 23, 10, 0, 0).unwrap(),
            deleted_at: None,
        }
    }

    #[test]
    fn work_order_serialization_round_trip_draft() {
        let wo = sample_wo();
        let json = serde_json::to_string(&wo).unwrap();
        let back: WorkOrder = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, wo.code);
        assert_eq!(back.status, WorkOrderStatus::Draft);
        // Draft has no lifecycle stamps yet.
        assert!(back.issued_at.is_none());
        assert!(back.completed_at.is_none());
        assert!(back.cancelled_at.is_none());
    }

    #[test]
    fn work_order_serialization_includes_status_as_snake_case() {
        let mut wo = sample_wo();
        wo.status = WorkOrderStatus::InProgress;
        let json = serde_json::to_string(&wo).unwrap();
        assert!(
            json.contains("\"status\":\"in_progress\""),
            "status must serialize as snake_case: {json}"
        );
    }

    #[test]
    fn work_order_material_round_trip_has_no_snapshot_name() {
        // Materials carry product_id only; name/sku are populated via JOIN
        // in `list_materials`. A raw deserialize must accept None for both.
        let m = WorkOrderMaterial {
            id: Uuid::nil(),
            work_order_id: Uuid::nil(),
            product_id: Uuid::nil(),
            product_name: None,
            product_sku: None,
            quantity_expected: 3.5,
            quantity_consumed: 0.0,
            notes: Some("rev A".to_string()),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: WorkOrderMaterial = serde_json::from_str(&json).unwrap();
        assert_eq!(back.quantity_expected, 3.5);
        assert_eq!(back.quantity_consumed, 0.0);
        assert_eq!(back.notes.as_deref(), Some("rev A"));
        assert!(back.product_name.is_none());
        assert!(back.product_sku.is_none());
    }
}
