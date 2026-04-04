use anyhow::{Context, Result};
use redis::aio::ConnectionManager;
use tracing::info;

/// Creates a Redis connection manager for async operations.
pub async fn create_redis_pool(redis_url: &str) -> Result<ConnectionManager> {
    let client = redis::Client::open(redis_url).context("invalid Redis URL")?;

    let manager = ConnectionManager::new(client)
        .await
        .context("failed to connect to Redis")?;

    info!("connected to Redis");

    Ok(manager)
}
