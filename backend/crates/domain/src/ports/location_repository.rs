use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::LocationType;
use crate::models::location::Location;

#[async_trait]
pub trait LocationRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Location>, DomainError>;
    async fn list_by_warehouse(
        &self,
        warehouse_id: Uuid,
        parent_id: Option<Uuid>,
        fetch_all: bool,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Location>, i64), DomainError>;
    async fn create(
        &self,
        warehouse_id: Uuid,
        parent_id: Option<Uuid>,
        location_type: LocationType,
        name: &str,
        label: Option<&str>,
    ) -> Result<Location, DomainError>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        label: Option<Option<&str>>,
        location_type: Option<LocationType>,
    ) -> Result<Location, DomainError>;
    async fn delete(&self, id: Uuid) -> Result<(), DomainError>;
    async fn has_inventory(&self, id: Uuid) -> Result<bool, DomainError>;
    async fn find_reception_by_warehouse(
        &self,
        warehouse_id: Uuid,
    ) -> Result<Option<Location>, DomainError>;
    /// Resolve the single `finished_good` system location for the given
    /// warehouse. Mirrors [`find_reception_by_warehouse`]. Returns `None` when
    /// no such row exists (pre-migration state or the idempotent backfill has
    /// not yet run — should never happen post-deploy because migration
    /// `20260423000003_backfill_finished_good_and_work_center_invariants.sql`
    /// is guaranteed to insert one per active warehouse).
    async fn find_finished_good_by_warehouse(
        &self,
        warehouse_id: Uuid,
    ) -> Result<Option<Location>, DomainError>;
    /// List every non-deleted `work_center` location in the warehouse.
    async fn list_work_centers_by_warehouse(
        &self,
        warehouse_id: Uuid,
    ) -> Result<Vec<Location>, DomainError>;
    /// Count non-deleted `work_center` locations in the warehouse. Used by the
    /// WO-create guard to reject a warehouse that has zero work-centers.
    async fn count_work_centers_by_warehouse(
        &self,
        warehouse_id: Uuid,
    ) -> Result<i64, DomainError>;
}
