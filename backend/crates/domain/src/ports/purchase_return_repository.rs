use async_trait::async_trait;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::{PurchaseReturnReason, PurchaseReturnStatus};
use crate::models::purchase_return::{PurchaseReturn, PurchaseReturnItem};

#[async_trait]
pub trait PurchaseReturnRepository: Send + Sync {
    async fn create(
        &self,
        po_id: Uuid,
        return_number: &str,
        reason: PurchaseReturnReason,
        reason_notes: Option<&str>,
        decrease_inventory: bool,
        refund_amount: Option<f64>,
        requested_by: Uuid,
        items: Vec<(Uuid, f64, f64, f64)>, // (product_id, qty_returned, qty_original, unit_price)
    ) -> Result<PurchaseReturn, DomainError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<PurchaseReturn>, DomainError>;

    async fn list(
        &self,
        po_id: Option<Uuid>,
        status: Option<PurchaseReturnStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PurchaseReturn>, i64), DomainError>;

    async fn update_status(
        &self,
        id: Uuid,
        status: PurchaseReturnStatus,
        refund_amount: Option<f64>,
    ) -> Result<PurchaseReturn, DomainError>;

    async fn delete(&self, id: Uuid) -> Result<(), DomainError>;

    async fn get_items(&self, return_id: Uuid) -> Result<Vec<PurchaseReturnItem>, DomainError>;

    async fn get_already_returned(
        &self,
        po_id: Uuid,
        product_id: Uuid,
    ) -> Result<f64, DomainError>;
}
