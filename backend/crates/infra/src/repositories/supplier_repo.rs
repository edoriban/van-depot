use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::supplier::Supplier;
use vandepot_domain::ports::supplier_repository::SupplierRepository;

use super::shared::map_sqlx_error;

#[derive(sqlx::FromRow)]
struct SupplierRow {
    id: Uuid,
    name: String,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<SupplierRow> for Supplier {
    fn from(row: SupplierRow) -> Self {
        Supplier {
            id: row.id,
            name: row.name,
            contact_name: row.contact_name,
            phone: row.phone,
            email: row.email,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

pub struct PgSupplierRepository {
    pool: PgPool,
}

impl PgSupplierRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const SUPPLIER_COLUMNS: &str = "id, name, contact_name, phone, email, is_active, created_at, updated_at";

#[async_trait]
impl SupplierRepository for PgSupplierRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Supplier>, DomainError> {
        let sql = format!(
            "SELECT {} FROM suppliers WHERE id = $1",
            SUPPLIER_COLUMNS
        );
        let row = sqlx::query_as::<_, SupplierRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(row.map(Supplier::from))
    }

    async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Supplier>, i64), DomainError> {
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM suppliers")
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        let sql = format!(
            "SELECT {} FROM suppliers ORDER BY created_at DESC LIMIT $1 OFFSET $2",
            SUPPLIER_COLUMNS
        );
        let rows: Vec<SupplierRow> = sqlx::query_as(&sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok((rows.into_iter().map(Into::into).collect(), total.0))
    }

    async fn create(
        &self,
        name: &str,
        contact_name: Option<&str>,
        phone: Option<&str>,
        email: Option<&str>,
    ) -> Result<Supplier, DomainError> {
        let sql = format!(
            "INSERT INTO suppliers (name, contact_name, phone, email) \
             VALUES ($1, $2, $3, $4) \
             RETURNING {}",
            SUPPLIER_COLUMNS
        );
        let row = sqlx::query_as::<_, SupplierRow>(&sql)
            .bind(name)
            .bind(contact_name)
            .bind(phone)
            .bind(email)
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Supplier::from(row))
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        contact_name: Option<Option<&str>>,
        phone: Option<Option<&str>>,
        email: Option<Option<&str>>,
    ) -> Result<Supplier, DomainError> {
        let sql = format!(
            "UPDATE suppliers SET \
                name = COALESCE($2, name), \
                contact_name = CASE WHEN $3 THEN $4 ELSE contact_name END, \
                phone = CASE WHEN $5 THEN $6 ELSE phone END, \
                email = CASE WHEN $7 THEN $8 ELSE email END, \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING {}",
            SUPPLIER_COLUMNS
        );
        let row = sqlx::query_as::<_, SupplierRow>(&sql)
            .bind(id)
            .bind(name)
            .bind(contact_name.is_some())
            .bind(contact_name.flatten())
            .bind(phone.is_some())
            .bind(phone.flatten())
            .bind(email.is_some())
            .bind(email.flatten())
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(Supplier::from(row))
    }

    async fn delete(&self, id: Uuid) -> Result<(), DomainError> {
        let result = sqlx::query("DELETE FROM suppliers WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        if result.rows_affected() == 0 {
            return Err(DomainError::NotFound("Supplier not found".to_string()));
        }

        Ok(())
    }

    async fn has_movements(&self, id: Uuid) -> Result<bool, DomainError> {
        let result: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM movements WHERE supplier_id = $1)",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(result.0)
    }
}
