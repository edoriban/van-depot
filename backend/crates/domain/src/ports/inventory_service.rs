use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::inventory_params::{
    AdjustmentParams, EntryParams, ExitParams, InventoryFilters, InventoryItem, MovementFilters,
    TransferParams,
};
use crate::models::movement::Movement;

#[async_trait]
pub trait InventoryService: Send + Sync {
    // ── Write operations ────────────────────────────────────────────
    async fn record_entry(&self, params: EntryParams) -> Result<Movement, DomainError>;
    async fn record_exit(&self, params: ExitParams) -> Result<Movement, DomainError>;
    async fn record_transfer(&self, params: TransferParams) -> Result<Movement, DomainError>;
    async fn record_adjustment(&self, params: AdjustmentParams) -> Result<Movement, DomainError>;

    // ── Movement queries ────────────────────────────────────────────
    async fn find_movement_by_id(&self, id: Uuid) -> Result<Option<Movement>, DomainError>;
    async fn list_movements(
        &self,
        filters: MovementFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Movement>, i64), DomainError>;

    // ── Inventory queries ───────────────────────────────────────────
    async fn list_inventory(
        &self,
        filters: InventoryFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<InventoryItem>, i64), DomainError>;
    async fn get_product_stock(&self, product_id: Uuid) -> Result<Vec<InventoryItem>, DomainError>;
    async fn get_location_stock(
        &self,
        location_id: Uuid,
    ) -> Result<Vec<InventoryItem>, DomainError>;
}
