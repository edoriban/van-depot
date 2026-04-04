use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::user::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DomainError>;
    async fn find_by_email(&self, email: &str) -> Result<Option<User>, DomainError>;
    async fn create(&self, user: &User) -> Result<User, DomainError>;
}
