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
    ///
    /// Note: per-tenant role is updated via the membership repository
    /// (`user_tenant_repo`) — never on the user aggregate itself.
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<User, DomainError>;

    /// Soft-delete a user by setting deleted_at.
    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError>;

    /// Update the password hash for a user.
    async fn change_password(&self, id: Uuid, password_hash: &str) -> Result<(), DomainError>;

    // B8.4: warehouse assignment (`assign_warehouse` / `revoke_warehouse` /
    // `list_user_warehouses`) moved to `user_warehouse_repo` (free-function
    // shape, takes `tenant_id` explicitly). Use `user_warehouse_repo::*` for
    // those operations.

    /// Activate an invited user by clearing the invite fields and setting a real password.
    async fn activate_invite(&self, id: Uuid, new_password_hash: &str) -> Result<(), DomainError>;
}
