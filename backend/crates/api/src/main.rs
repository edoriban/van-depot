use std::env;

use axum::{Router, routing::get};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod error;
mod extractors;
mod pagination;
mod routes;
mod state;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let redis_url =
        env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6381".to_string());

    let pool = vandepot_infra::db::create_pool(&database_url).await?;
    let redis = vandepot_infra::redis::create_redis_pool(&redis_url).await?;
    let jwt_config = vandepot_infra::auth::jwt::JwtConfig::from_env()?;

    // Seed superadmin and demo data
    vandepot_infra::seed::seed_superadmin(&pool).await?;
    vandepot_infra::seed::seed_demo_data(&pool).await?;

    let state = state::AppState {
        pool,
        redis,
        jwt_config,
    };

    let app = Router::new()
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
        .merge(routes::stock_config::stock_config_routes())
        .merge(routes::inventory::inventory_routes())
        .merge(routes::cycle_counts::cycle_count_routes())
        .merge(routes::dashboard::dashboard_routes())
        .merge(routes::alerts::alert_routes())
        .merge(routes::notifications::notification_routes())
        .merge(routes::recipes::recipe_routes())
        .merge(routes::abc::abc_routes())
        .merge(routes::warehouse_map::warehouse_map_routes())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let host = env::var("API_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = env::var("BACKEND_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("{host}:{port}");

    tracing::info!("VanDepot API listening on {addr}");

    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install CTRL+C signal handler");
    tracing::info!("shutdown signal received, starting graceful shutdown");
}
