use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::{ProductClass, UnitType};
use crate::models::product::Product;

/// Snapshot of the blockers that prevent a product's class from being
/// changed. `locked` is a convenience flag equivalent to
/// `movements + lots + tool_instances > 0`.
#[derive(Debug, Clone, Copy)]
pub struct ClassLockStatus {
    pub locked: bool,
    pub movements: i64,
    pub lots: i64,
    pub tool_instances: i64,
}

#[async_trait]
pub trait ProductRepository: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Product>, DomainError>;
    #[allow(clippy::too_many_arguments)]
    async fn list(
        &self,
        search: Option<&str>,
        category_id: Option<Uuid>,
        product_class: Option<ProductClass>,
        is_manufactured: Option<bool>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Product>, i64), DomainError>;
    #[allow(clippy::too_many_arguments)]
    async fn create(
        &self,
        name: &str,
        sku: &str,
        description: Option<&str>,
        category_id: Option<Uuid>,
        unit_of_measure: UnitType,
        product_class: ProductClass,
        has_expiry: bool,
        is_manufactured: bool,
        min_stock: f64,
        max_stock: Option<f64>,
        created_by: Option<Uuid>,
    ) -> Result<Product, DomainError>;
    #[allow(clippy::too_many_arguments)]
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        sku: Option<&str>,
        description: Option<Option<&str>>,
        category_id: Option<Option<Uuid>>,
        unit_of_measure: Option<UnitType>,
        has_expiry: Option<bool>,
        is_manufactured: Option<bool>,
        min_stock: Option<f64>,
        max_stock: Option<Option<f64>>,
        updated_by: Option<Uuid>,
    ) -> Result<Product, DomainError>;
    async fn soft_delete(&self, id: Uuid) -> Result<(), DomainError>;

    /// Change a product's `product_class`. Fails with
    /// `DomainError::ClassLocked` if the product already has any history
    /// (movements, lots, or tool instances).
    async fn reclassify(
        &self,
        id: Uuid,
        new_class: ProductClass,
        updated_by: Option<Uuid>,
    ) -> Result<Product, DomainError>;

    /// Read-only probe of the product's class-lock state. The UI uses this
    /// to pre-disable the reclassify button without triggering the 409
    /// error path.
    async fn class_lock_status(&self, id: Uuid) -> Result<ClassLockStatus, DomainError>;
}
