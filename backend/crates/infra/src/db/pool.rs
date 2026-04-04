use anyhow::{Context, Result};
use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::info;

/// Creates a PostgreSQL connection pool and runs pending migrations.
pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .min_connections(2)
        .connect(database_url)
        .await
        .context("failed to connect to PostgreSQL")?;

    info!("connected to PostgreSQL");

    sqlx::migrate!("../../migrations")
        .run(&pool)
        .await
        .context("failed to run database migrations")?;

    info!("database migrations applied");

    Ok(pool)
}
