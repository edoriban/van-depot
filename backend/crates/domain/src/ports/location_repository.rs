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
}
