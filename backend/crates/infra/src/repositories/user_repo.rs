use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::user::User;
use vandepot_domain::ports::user_repository::UserRepository;

use super::shared::map_sqlx_error;

/// Internal row representation for sqlx `FromRow` derivation.
/// Avoids the `query_as!` macro which requires a live `DATABASE_URL` at compile time.
///
/// A3: the legacy `users.role` column was dropped. Per-tenant authorization is
/// resolved via `user_tenants.role`; the global superadmin bypass is the
/// `is_superadmin` boolean.
#[derive(sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    password_hash: String,
    name: String,
    is_superadmin: bool,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    invite_code_hash: Option<String>,
    invite_expires_at: Option<DateTime<Utc>>,
    must_set_password: bool,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        User {
            id: row.id,
            email: row.email,
            password_hash: row.password_hash,
            name: row.name,
            is_superadmin: row.is_superadmin,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            invite_code_hash: row.invite_code_hash,
            invite_expires_at: row.invite_expires_at,
            must_set_password: row.must_set_password,
        }
    }
}

pub struct PgUserRepository {
    pool: PgPool,
}

impl PgUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepository for PgUserRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DomainError> {
        let row = sqlx::query_as::<_, UserRow>(
            "SELECT id, email, password_hash, name, is_superadmin, is_active, created_at, updated_at, deleted_at, \
                    invite_code_hash, invite_expires_at, must_set_password \
             FROM users WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(row.map(User::from))
    }

    async fn find_by_email(&self, email: &str) -> Result<Option<User>, DomainError> {
        let row = sqlx::query_as::<_, UserRow>(
            "SELECT id, email, password_hash, name, is_superadmin, is_active, created_at, updated_at, deleted_at, \
                    invite_code_hash, invite_expires_at, must_set_password \
             FROM users WHERE email = $1 AND deleted_at IS NULL",
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(row.map(User::from))
    }

    async fn create(&self, user: &User) -> Result<User, DomainError> {
        let row = sqlx::query_as::<_, UserRow>(
            "INSERT INTO users (email, password_hash, name, invite_code_hash, invite_expires_at, must_set_password) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING id, email, password_hash, name, is_superadmin, is_active, created_at, updated_at, deleted_at, \
                       invite_code_hash, invite_expires_at, must_set_password",
        )
        .bind(&user.email)
        .bind(&user.password_hash)
        .bind(&user.name)
        .bind(&user.invite_code_hash)
        .bind(user.invite_expires_at)
        .bind(user.must_set_password)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(User::from(row))
    }

    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<User>, i64), DomainError> {
        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_error)?;

        let rows: Vec<UserRow> = sqlx::query_as(
            "SELECT id, email, password_hash, name, is_superadmin, is_active, created_at, updated_at, deleted_at, \
                    invite_code_hash, invite_expires_at, must_set_password \
             FROM users WHERE deleted_at IS NULL \
             ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn list_by_warehouses(
        &self,
        warehouse_ids: &[Uuid],
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<User>, i64), DomainError> {
        if warehouse_ids.is_empty() {
            return Ok((vec![], 0));
        }

        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT u.id) \
             FROM users u \
             INNER JOIN user_warehouses uw ON u.id = uw.user_id \
             WHERE u.deleted_at IS NULL AND uw.warehouse_id = ANY($1)",
        )
        .bind(warehouse_ids)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let rows: Vec<UserRow> = sqlx::query_as(
            "SELECT DISTINCT u.id, u.email, u.password_hash, u.name, u.is_superadmin, u.is_active, \
                    u.created_at, u.updated_at, u.deleted_at, \
                    u.invite_code_hash, u.invite_expires_at, u.must_set_password \
             FROM users u \
             INNER JOIN user_warehouses uw ON u.id = uw.user_id \
             WHERE u.deleted_at IS NULL AND uw.warehouse_id = ANY($1) \
             ORDER BY u.created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(warehouse_ids)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<User, DomainError> {
        let row = sqlx::query_as::<_, UserRow>(
            "UPDATE users SET \
                name = COALESCE($2, name), \
                is_active = COALESCE($3, is_active) \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, email, password_hash, name, is_superadmin, is_active, created_at, updated_at, deleted_at, \
                       invite_code_hash, invite_expires_at, must_set_password",
        )
        .bind(id)
        .bind(name)
        .bind(is_active)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(User::from(row))
    }

    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("User not found".to_string()));
        }

        Ok(())
    }

    async fn change_password(&self, id: Uuid, password_hash: &str) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE users SET password_hash = $2 WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(password_hash)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("User not found".to_string()));
        }

        Ok(())
    }

    async fn activate_invite(&self, id: Uuid, new_password_hash: &str) -> Result<(), DomainError> {
        let result = sqlx::query(
            "UPDATE users \
             SET password_hash = $2, \
                 invite_code_hash = NULL, \
                 invite_expires_at = NULL, \
                 must_set_password = false \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(new_password_hash)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("User not found".to_string()));
        }

        Ok(())
    }
}

// `get_user_warehouse_ids` (legacy, single-arg `user_id`) was retired in
// B8.4. Callers now use `user_warehouse_repo::list_for_user(&mut conn,
// tenant_id, user_id)` which threads the active tenant explicitly. After
// B8.1 the `user_warehouses` table carries `tenant_id` natively and the
// composite FK to `user_tenants(tenant_id, user_id)` enforces membership at
// the DB level.

// A6 added a `list_user_memberships` bridge here; A8 moved it to
// `user_tenant_repo::list_for_user`. New callers MUST use the repo module.
