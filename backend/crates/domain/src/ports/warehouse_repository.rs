use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::warehouse::Warehouse;

#[async_trait]
pub trait WarehouseRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Warehouse>, DomainError>;
    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Warehouse>, i64), DomainError>;
    async fn create(&self, name: &str, address: Option<&str>) -> Result<Warehouse, DomainError>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        address: Option<Option<&str>>,
    ) -> Result<Warehouse, DomainError>;
    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError>;
}
