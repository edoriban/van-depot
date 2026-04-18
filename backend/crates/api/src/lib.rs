// Library entry-point for the vandepot-api crate. Exposes the modules so
// integration tests (under `crates/api/tests/`) can build a test router using
// the same route/handler/state wiring as the production binary.

pub mod error;
pub mod extractors;
pub mod pagination;
pub mod routes;
pub mod state;

use axum::{routing::get, Router};
use state::AppState;

/// Build the full application router. Used by `main.rs` at runtime and by
/// integration tests to mount all routes against a test `AppState`.
pub fn app_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .merge(routes::auth::auth_routes())
        .merge(routes::warehouses::warehouse_routes())
        .merge(routes::users::user_routes())
        .merge(routes::locations::location_routes())
        .merge(routes::categories::category_routes())
        .merge(routes::products::product_routes())
        .merge(routes::suppliers::supplier_routes())
        .merge(routes::supplier_products::supplier_product_routes())
        .merge(routes::movements::movement_routes())
        .merge(routes::lots::lot_routes())
        .merge(routes::purchase_orders::purchase_order_routes())
        .merge(routes::purchase_returns::purchase_return_routes())
        .merge(routes::stock_config::stock_config_routes())
        .merge(routes::inventory::inventory_routes())
        .merge(routes::cycle_counts::cycle_count_routes())
        .merge(routes::dashboard::dashboard_routes())
        .merge(routes::alerts::alert_routes())
        .merge(routes::notifications::notification_routes())
        .merge(routes::recipes::recipe_routes())
        .merge(routes::abc::abc_routes())
        .merge(routes::warehouse_map::warehouse_map_routes())
        .with_state(state)
}
