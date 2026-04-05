use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::user::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DomainError>;
    async fn find_by_email(&self, email: &str) -> Result<Option<User>, DomainError>;
    async fn create(&self, user: &User) -> Result<User, DomainError>;

    /// List all users with pagination. Returns (users, total_count).
    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<User>, i64), DomainError>;

    /// List users that belong to any of the given warehouse IDs (for owner scoping).
    async fn list_by_warehouses(
        &self,
        warehouse_ids: &[Uuid],
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<User>, i64), DomainError>;

    /// Update user fields. Only provided (Some) values are changed.
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        role: Option<&crate::models::enums::UserRole>,
        is_active: Option<bool>,
    ) -> Result<User, DomainError>;

    /// Soft-delete a user by setting deleted_at.
    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError>;

    /// Update the password hash for a user.
    async fn change_password(&self, id: Uuid, password_hash: &str) -> Result<(), DomainError>;

    /// Assign a user to a warehouse.
    async fn assign_warehouse(&self, user_id: Uuid, warehouse_id: Uuid) -> Result<(), DomainError>;

    /// Revoke a user's access to a warehouse.
    async fn revoke_warehouse(&self, user_id: Uuid, warehouse_id: Uuid) -> Result<(), DomainError>;

    /// List warehouse IDs assigned to a user.
    async fn list_user_warehouses(&self, user_id: Uuid) -> Result<Vec<Uuid>, DomainError>;
}
