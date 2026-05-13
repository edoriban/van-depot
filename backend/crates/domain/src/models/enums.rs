use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "purchase_order_status", rename_all = "snake_case")]
pub enum PurchaseOrderStatus {
    Draft,
    Sent,
    PartiallyReceived,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "unit_type", rename_all = "snake_case")]
pub enum UnitType {
    Piece,
    Kg,
    Gram,
    Liter,
    Ml,
    Meter,
    Cm,
    Box,
    Pack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "movement_type", rename_all = "snake_case")]
pub enum MovementType {
    Entry,
    Exit,
    Transfer,
    Adjustment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "location_type", rename_all = "snake_case")]
pub enum LocationType {
    Zone,
    Rack,
    Shelf,
    Position,
    Bin,
    Reception,
    WorkCenter,
    FinishedGood,
    Outbound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "quality_status", rename_all = "snake_case")]
pub enum QualityStatus {
    Pending,
    Approved,
    Rejected,
    Quarantine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "purchase_return_status", rename_all = "snake_case")]
pub enum PurchaseReturnStatus {
    Pending,
    ShippedToSupplier,
    Refunded,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "purchase_return_reason", rename_all = "snake_case")]
pub enum PurchaseReturnReason {
    Damaged,
    Defective,
    WrongProduct,
    Expired,
    ExcessInventory,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "product_class", rename_all = "snake_case")]
pub enum ProductClass {
    RawMaterial,
    Consumable,
    ToolSpare,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "work_order_status", rename_all = "snake_case")]
pub enum WorkOrderStatus {
    Draft,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "picking_list_status", rename_all = "snake_case")]
pub enum PickingListStatus {
    Draft,
    Released,
    Assigned,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "picking_line_status", rename_all = "snake_case")]
pub enum PickingLineStatus {
    Pending,
    Picked,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "reservation_status", rename_all = "snake_case")]
pub enum ReservationStatus {
    Active,
    Released,
    Consumed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "picking_allocation_strategy", rename_all = "snake_case")]
pub enum PickingAllocationStrategy {
    Fefo,
}

impl WorkOrderStatus {
    /// Legal state transitions for a work order. Any combination NOT listed
    /// below is rejected by `PgWorkOrderRepository::{issue,complete,cancel}`
    /// with a `DomainError::WorkOrderInvalidTransition`.
    ///
    /// Legal transitions (design §3a-d):
    ///   draft        → in_progress  (issue)
    ///   draft        → cancelled    (cancel)
    ///   in_progress  → completed    (complete)
    ///   in_progress  → cancelled    (cancel w/ reversal)
    ///
    /// All other combinations (including same-state no-ops like draft→draft)
    /// are illegal.
    pub fn can_transition_to(&self, target: &Self) -> bool {
        matches!(
            (self, target),
            (Self::Draft, Self::InProgress)
                | (Self::Draft, Self::Cancelled)
                | (Self::InProgress, Self::Completed)
                | (Self::InProgress, Self::Cancelled)
        )
    }
}

#[cfg(test)]
mod tests {
    //! Task 6.1 — `ProductClass` serde round-trip.
    //!
    //! The wire representation is stable public API: frontend clients and
    //! DB migrations rely on the snake_case tokens. These tests catch
    //! accidental rename-breaks (e.g. someone flipping `rename_all` or
    //! reordering variants).
    //!
    //! The sqlx half of the round-trip is exercised by the integration
    //! tests in `backend/crates/infra/tests/product_classification.rs`
    //! and `backend/crates/api/tests/product_classification.rs` which hit
    //! real Postgres — we don't duplicate the wire check here.
    use super::ProductClass;

    #[test]
    fn serialize_each_variant_to_snake_case() {
        assert_eq!(
            serde_json::to_string(&ProductClass::RawMaterial).unwrap(),
            "\"raw_material\""
        );
        assert_eq!(
            serde_json::to_string(&ProductClass::Consumable).unwrap(),
            "\"consumable\""
        );
        assert_eq!(
            serde_json::to_string(&ProductClass::ToolSpare).unwrap(),
            "\"tool_spare\""
        );
    }

    #[test]
    fn deserialize_snake_case_back_to_variant() {
        let raw: ProductClass = serde_json::from_str("\"raw_material\"").unwrap();
        assert_eq!(raw, ProductClass::RawMaterial);

        let cons: ProductClass = serde_json::from_str("\"consumable\"").unwrap();
        assert_eq!(cons, ProductClass::Consumable);

        let tool: ProductClass = serde_json::from_str("\"tool_spare\"").unwrap();
        assert_eq!(tool, ProductClass::ToolSpare);
    }

    #[test]
    fn deserialize_unknown_variant_fails() {
        // The route layer depends on this: `?class=widget` must return 4xx
        // rather than silently ignoring the filter.
        let err = serde_json::from_str::<ProductClass>("\"widget\"");
        assert!(err.is_err(), "unknown variant must fail to deserialize");
    }

    #[test]
    fn round_trip_preserves_variant() {
        for variant in [
            ProductClass::RawMaterial,
            ProductClass::Consumable,
            ProductClass::ToolSpare,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let back: ProductClass = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, back);
        }
    }

    // ─── Task 6.1 — WorkOrderStatus serde + transition legality ─────────
    //
    // (a) per-variant serde round-trip (snake_case stability).
    // (b) 16-cell transition legality matrix (4 legal + 12 illegal).
    //
    // These are the wire-level contracts both the frontend (status chips,
    // action buttons) and the backend (repo guards) depend on. A silent
    // rename or an off-by-one in the transition table would break either a
    // state-machine assertion or a UI chip label — catch it here.
    use super::WorkOrderStatus;

    #[test]
    fn work_order_status_serde_round_trip_draft() {
        let v = WorkOrderStatus::Draft;
        assert_eq!(serde_json::to_string(&v).unwrap(), "\"draft\"");
        let back: WorkOrderStatus = serde_json::from_str("\"draft\"").unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn work_order_status_serde_round_trip_in_progress() {
        let v = WorkOrderStatus::InProgress;
        assert_eq!(serde_json::to_string(&v).unwrap(), "\"in_progress\"");
        let back: WorkOrderStatus = serde_json::from_str("\"in_progress\"").unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn work_order_status_serde_round_trip_completed() {
        let v = WorkOrderStatus::Completed;
        assert_eq!(serde_json::to_string(&v).unwrap(), "\"completed\"");
        let back: WorkOrderStatus = serde_json::from_str("\"completed\"").unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn work_order_status_serde_round_trip_cancelled() {
        let v = WorkOrderStatus::Cancelled;
        assert_eq!(serde_json::to_string(&v).unwrap(), "\"cancelled\"");
        let back: WorkOrderStatus = serde_json::from_str("\"cancelled\"").unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn work_order_status_rejects_unknown_variant() {
        let err = serde_json::from_str::<WorkOrderStatus>("\"pending\"");
        assert!(err.is_err(), "unknown WO status must fail to deserialize");
    }

    #[test]
    fn work_order_status_transition_matrix_legal_cells() {
        // 4 legal cells (design §3a-d).
        assert!(WorkOrderStatus::Draft.can_transition_to(&WorkOrderStatus::InProgress));
        assert!(WorkOrderStatus::Draft.can_transition_to(&WorkOrderStatus::Cancelled));
        assert!(WorkOrderStatus::InProgress.can_transition_to(&WorkOrderStatus::Completed));
        assert!(WorkOrderStatus::InProgress.can_transition_to(&WorkOrderStatus::Cancelled));
    }

    #[test]
    fn work_order_status_transition_matrix_illegal_cells() {
        // 12 illegal cells, including all same-state no-ops and terminal
        // forward-moves.
        let all = [
            WorkOrderStatus::Draft,
            WorkOrderStatus::InProgress,
            WorkOrderStatus::Completed,
            WorkOrderStatus::Cancelled,
        ];
        let legal: &[(WorkOrderStatus, WorkOrderStatus)] = &[
            (WorkOrderStatus::Draft, WorkOrderStatus::InProgress),
            (WorkOrderStatus::Draft, WorkOrderStatus::Cancelled),
            (WorkOrderStatus::InProgress, WorkOrderStatus::Completed),
            (WorkOrderStatus::InProgress, WorkOrderStatus::Cancelled),
        ];
        for from in &all {
            for to in &all {
                let is_legal = legal.iter().any(|(f, t)| f == from && t == to);
                if !is_legal {
                    assert!(
                        !from.can_transition_to(to),
                        "expected {from:?}→{to:?} to be illegal"
                    );
                }
            }
        }
    }

    #[test]
    fn work_order_status_full_matrix_matches_expected() {
        // Sanity: count legal transitions to 4 exactly. A regression that
        // adds a 5th legal path would break downstream repo assumptions.
        let all = [
            WorkOrderStatus::Draft,
            WorkOrderStatus::InProgress,
            WorkOrderStatus::Completed,
            WorkOrderStatus::Cancelled,
        ];
        let mut legal_count = 0;
        for from in &all {
            for to in &all {
                if from.can_transition_to(to) {
                    legal_count += 1;
                }
            }
        }
        assert_eq!(legal_count, 4, "expected exactly 4 legal transitions");
    }
}
