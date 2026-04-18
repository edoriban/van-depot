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
