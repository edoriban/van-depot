use serde::{Deserialize, Serialize};

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
}
