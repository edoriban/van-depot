use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::category::Category;

#[async_trait]
pub trait CategoryRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Category>, DomainError>;
    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Category>, i64), DomainError>;
    async fn create(&self, name: &str, parent_id: Option<Uuid>) -> Result<Category, DomainError>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        parent_id: Option<Option<Uuid>>,
    ) -> Result<Category, DomainError>;
    async fn delete(&self, id: Uuid) -> Result<(), DomainError>;
    async fn has_children(&self, id: Uuid) -> Result<bool, DomainError>;
    async fn has_products(&self, id: Uuid) -> Result<bool, DomainError>;
}
