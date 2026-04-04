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

