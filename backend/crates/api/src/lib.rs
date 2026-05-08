// Library entry-point for the vandepot-api crate. Exposes the modules so
// integration tests (under `crates/api/tests/`) can build a test router using
// the same route/handler/state wiring as the production binary.

pub mod error;
pub mod extractors;
pub mod middleware;
pub mod pagination;
pub mod routes;
pub mod state;

use axum::{middleware::from_fn_with_state, routing::get, Router};
use state::AppState;

use crate::middleware::tenant_tx::tenant_tx_middleware;

/// Build the full application router. Used by `main.rs` at runtime and by
/// integration tests to mount all routes against a test `AppState`.
///
/// Phase C task C3: every authenticated route is wrapped by
/// [`tenant_tx_middleware`], which opens a per-request transaction with the
/// caller's RLS context (`SET LOCAL app.current_tenant`,
/// `SET LOCAL app.is_superadmin`) and stores a `TenantTxHandle` in request
/// extensions for the `Tenant` extractor to pick up.
///
/// The unauthenticated routes (`/health`, `/auth/*`) are merged OUTSIDE the
/// tx-wrapped subtree because the middleware requires a valid `Claims`
/// payload — applying it to `/auth/login` would 401 before the user can log
/// in.
pub fn app_router(state: AppState) -> Router {
    // Authenticated subtree — every route under here gets a per-request tx.
    let authenticated = Router::new()
        // Admin sub-router — gated by superadmin_guard. Built with the
        // state cloned in here because the guard middleware needs it at
        // construction time (`from_fn_with_state`).
        .merge(routes::admin::admin_routes(state.clone()))
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
        .merge(routes::work_orders::work_order_routes())
        .layer(from_fn_with_state(state.clone(), tenant_tx_middleware));

    Router::new()
        .route("/health", get(routes::health::health))
        .merge(routes::auth::auth_routes())
        .merge(authenticated)
        .with_state(state)
}
