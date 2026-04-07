use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::UnitType;
use crate::models::product::Product;

#[async_trait]
pub trait ProductRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Product>, DomainError>;
    async fn list(
        &self,
        search: Option<&str>,
        category_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Product>, i64), DomainError>;
    async fn create(
        &self,
        name: &str,
        sku: &str,
        description: Option<&str>,
        category_id: Option<Uuid>,
        unit_of_measure: UnitType,
        min_stock: f64,
        max_stock: Option<f64>,
        created_by: Option<Uuid>,
    ) -> Result<Product, DomainError>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        sku: Option<&str>,
        description: Option<Option<&str>>,
        category_id: Option<Option<Uuid>>,
        unit_of_measure: Option<UnitType>,
        min_stock: Option<f64>,
        max_stock: Option<Option<f64>>,
        updated_by: Option<Uuid>,
    ) -> Result<Product, DomainError>;
    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError>;
}
