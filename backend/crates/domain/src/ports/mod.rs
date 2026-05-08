// `category_repository`, `location_repository`, `product_repository`,
// `supplier_repository`, `warehouse_repository`, `inventory_service`,
// `work_order_repository`, `purchase_order_repository`, and
// `purchase_return_repository` traits were retired in Phase B batches
// 1..6 (multi-tenant-foundation). Repos and services are now FREE
// FUNCTIONS that take `&mut PgConnection` (or `&PgPool` for
// multi-statement writes) + `tenant_id: Uuid`. The trait abstraction
// provided no testing or substitution value once the executor became
// a connection reference rather than a captured pool. See
// `infra::repositories::*` for the canonical signature pattern that
// B7..B8 continue to follow.
pub mod user_repository;
