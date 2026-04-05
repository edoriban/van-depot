use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::UserRole;
use vandepot_domain::models::user::User;
use vandepot_domain::ports::user_repository::UserRepository;

use super::shared::map_sqlx_error;

/// Internal row representation for sqlx `FromRow` derivation.
/// Avoids the `query_as!` macro which requires a live `DATABASE_URL` at compile time.
#[derive(sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    password_hash: String,
    name: String,
    role: UserRole,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        User {
            id: row.id,
            email: row.email,
            password_hash: row.password_hash,
            name: row.name,
            role: row.role,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
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
            "SELECT id, email, password_hash, name, role, is_active, created_at, updated_at, deleted_at \
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
            "SELECT id, email, password_hash, name, role, is_active, created_at, updated_at, deleted_at \
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
            "INSERT INTO users (email, password_hash, name, role) \
             VALUES ($1, $2, $3, $4) \
             RETURNING id, email, password_hash, name, role, is_active, created_at, updated_at, deleted_at",
        )
        .bind(&user.email)
        .bind(&user.password_hash)
        .bind(&user.name)
        .bind(&user.role)
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
            "SELECT id, email, password_hash, name, role, is_active, created_at, updated_at, deleted_at \
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
            "SELECT DISTINCT u.id, u.email, u.password_hash, u.name, u.role, u.is_active, \
                    u.created_at, u.updated_at, u.deleted_at \
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
        role: Option<&UserRole>,
        is_active: Option<bool>,
    ) -> Result<User, DomainError> {
        let row = sqlx::query_as::<_, UserRow>(
            "UPDATE users SET \
                name = COALESCE($2, name), \
                role = COALESCE($3, role), \
                is_active = COALESCE($4, is_active) \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, email, password_hash, name, role, is_active, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(name)
        .bind(role.cloned())
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

    async fn assign_warehouse(&self, user_id: Uuid, warehouse_id: Uuid) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1, $2) \
             ON CONFLICT (user_id, warehouse_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(warehouse_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn revoke_warehouse(&self, user_id: Uuid, warehouse_id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query(
            "DELETE FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2",
        )
        .bind(user_id)
        .bind(warehouse_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound(
                "Warehouse assignment not found".to_string(),
            ));
        }

        Ok(())
    }

    async fn list_user_warehouses(&self, user_id: Uuid) -> Result<Vec<Uuid>, DomainError> {
        let ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT warehouse_id FROM user_warehouses WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

        Ok(ids)
    }
}

/// Returns warehouse IDs associated with a given user.
///
/// This is a standalone function (not part of `UserRepository` trait) because
/// it serves JWT claim construction and doesn't map to the `User` aggregate.
pub async fn get_user_warehouse_ids(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, DomainError> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT warehouse_id FROM user_warehouses WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    Ok(ids)
}
