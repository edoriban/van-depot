use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::supplier::Supplier;

#[async_trait]
pub trait SupplierRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Supplier>, DomainError>;
    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Supplier>, i64), DomainError>;
    async fn create(
        &self,
        name: &str,
        contact_name: Option<&str>,
        phone: Option<&str>,
        email: Option<&str>,
    ) -> Result<Supplier, DomainError>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        contact_name: Option<Option<&str>>,
        phone: Option<Option<&str>>,
        email: Option<Option<&str>>,
    ) -> Result<Supplier, DomainError>;
    async fn delete(&self, id: Uuid) -> Result<(), DomainError>;
    async fn has_movements(&self, id: Uuid) -> Result<bool, DomainError>;
}
