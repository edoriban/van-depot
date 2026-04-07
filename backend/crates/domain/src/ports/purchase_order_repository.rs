use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::PurchaseOrderStatus;
use crate::models::purchase_order::PurchaseOrder;
use crate::models::purchase_order_line::PurchaseOrderLine;

pub struct PurchaseOrderFilters {
    pub status: Option<PurchaseOrderStatus>,
    pub supplier_id: Option<Uuid>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
}

#[async_trait]
pub trait PurchaseOrderRepository: Send + Sync {
    async fn create(
        &self,
        supplier_id: Uuid,
        order_number: &str,
        expected_delivery_date: Option<NaiveDate>,
        notes: Option<&str>,
        created_by: Uuid,
    ) -> Result<PurchaseOrder, DomainError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<PurchaseOrder>, DomainError>;

    async fn list(
        &self,
        filters: PurchaseOrderFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PurchaseOrder>, i64), DomainError>;

    async fn update(
        &self,
        id: Uuid,
        expected_delivery_date: Option<Option<NaiveDate>>,
        notes: Option<Option<&str>>,
    ) -> Result<PurchaseOrder, DomainError>;

    async fn send(&self, id: Uuid) -> Result<PurchaseOrder, DomainError>;

    async fn cancel(&self, id: Uuid) -> Result<PurchaseOrder, DomainError>;

    async fn add_line(
        &self,
        purchase_order_id: Uuid,
        product_id: Uuid,
        quantity_ordered: f64,
        unit_price: f64,
        notes: Option<&str>,
    ) -> Result<PurchaseOrderLine, DomainError>;

    async fn update_line(
        &self,
        line_id: Uuid,
        quantity_ordered: Option<f64>,
        unit_price: Option<f64>,
        notes: Option<Option<&str>>,
    ) -> Result<PurchaseOrderLine, DomainError>;

    async fn delete_line(&self, line_id: Uuid) -> Result<(), DomainError>;

    async fn get_lines(
        &self,
        purchase_order_id: Uuid,
    ) -> Result<Vec<PurchaseOrderLine>, DomainError>;
}
