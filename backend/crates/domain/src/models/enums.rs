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
#[sqlx(type_name = "user_role", rename_all = "snake_case")]
pub enum UserRole {
    Superadmin,
    Owner,
    WarehouseManager,
    Operator,
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
}
