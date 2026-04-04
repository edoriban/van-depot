use std::env;

use axum::{Json, Router, routing::get};
use serde::Serialize;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "vandepot-api",
        version: "0.1.0",
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let app = Router::new()
        .route("/health", get(health_check))
        .layer(CorsLayer::permissive());

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
