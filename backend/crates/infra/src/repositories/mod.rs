pub mod abc_repo;
pub mod alerts_repo;
pub mod audit_log_repo;
pub mod category_repo;
pub mod notifications_repo;
pub mod cycle_count_repo;
pub mod dashboard_repo;
pub mod inventory_repo;
pub mod location_repo;
pub mod lots_repo;
pub mod product_repo;
pub mod purchase_order_repo;
pub mod purchase_return_repo;
pub mod recipes_repo;
pub mod shared;
pub mod stock_config_repo;
pub mod supplier_products_repo;
pub mod supplier_repo;
pub mod tenant_repo;
pub mod tool_instances_repo;
pub mod user_repo;
pub mod user_tenant_repo;
pub mod user_warehouse_repo;
pub mod warehouse_map_repo;
pub mod warehouse_repo;
pub mod work_orders_repo;

pub use user_repo::PgUserRepository;
// `PgWarehouseRepository` / `PgLocationRepository` (retired Phase B B1),
// `PgProductRepository` / `PgCategoryRepository` (retired Phase B B2),
// `PgSupplierRepository` (retired Phase B B3), `PgInventoryService`
// (retired Phase B B4), `PgWorkOrderRepository` (retired Phase B B5),
// `PgPurchaseOrderRepository` / `PgPurchaseReturnRepository` (retired
// Phase B B6), and `PgCycleCountRepository` (retired Phase B B7) are
// gone. Use `warehouse_repo::*`, `location_repo::*`, `product_repo::*`,
// `category_repo::*`, `supplier_repo::*`, `inventory_repo::*` /
// `lots_repo::*`, `recipes_repo::*`, `work_orders_repo::*`,
// `purchase_order_repo::*`, `purchase_return_repo::*`, and
// `cycle_count_repo::*` free functions directly.
