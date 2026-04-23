use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::enums::WorkOrderStatus;
use crate::models::work_order::{WorkOrder, WorkOrderMaterial};

/// Filter bag for `list`. Each field composes with AND; omitting all returns
/// the full non-deleted WO set.
#[derive(Debug, Clone, Default)]
pub struct WorkOrderFilters {
    pub status: Option<WorkOrderStatus>,
    pub warehouse_id: Option<Uuid>,
    pub work_center_location_id: Option<Uuid>,
    /// Substring match against `code` or the FG product name (via JOIN).
    pub search: Option<String>,
}

/// Input for `create`. The repo builds the code + snapshots the BOM from the
/// referenced recipe in one transaction.
#[derive(Debug, Clone)]
pub struct CreateWorkOrderParams {
    pub recipe_id: Uuid,
    pub fg_product_id: Uuid,
    pub fg_quantity: f64,
    pub warehouse_id: Uuid,
    pub work_center_location_id: Uuid,
    pub notes: Option<String>,
    pub created_by: Uuid,
}

/// Optional operator-supplied source for a single material during `issue`.
/// When the list is omitted entirely the repo auto-picks per material per
/// design §3b (deterministic: highest-qty location in the same warehouse,
/// excluding reception/work_center/finished_good).
#[derive(Debug, Clone)]
pub struct MaterialSourceOverride {
    pub product_id: Uuid,
    pub from_location_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct IssueResult {
    pub work_order: WorkOrder,
    pub movement_ids: Vec<Uuid>,
}

#[derive(Debug, Clone)]
pub struct CompleteResult {
    pub work_order: WorkOrder,
    pub consumed_movement_ids: Vec<Uuid>,
    pub fg_lot_id: Uuid,
    pub fg_movement_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct CancelResult {
    pub work_order: WorkOrder,
    pub reversal_movement_ids: Vec<Uuid>,
}

#[async_trait]
pub trait WorkOrderRepository: Send + Sync {
    async fn list(
        &self,
        filters: WorkOrderFilters,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<WorkOrder>, i64), DomainError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<WorkOrder>, DomainError>;

    async fn list_materials(
        &self,
        work_order_id: Uuid,
    ) -> Result<Vec<WorkOrderMaterial>, DomainError>;

    async fn create(&self, params: CreateWorkOrderParams) -> Result<WorkOrder, DomainError>;

    async fn issue(
        &self,
        id: Uuid,
        user_id: Uuid,
        overrides: Vec<MaterialSourceOverride>,
    ) -> Result<IssueResult, DomainError>;

    async fn complete(
        &self,
        id: Uuid,
        user_id: Uuid,
        fg_expiration_date: Option<NaiveDate>,
    ) -> Result<CompleteResult, DomainError>;

    async fn cancel(&self, id: Uuid, user_id: Uuid) -> Result<CancelResult, DomainError>;
}
