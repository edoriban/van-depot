use anyhow::Result;
use sqlx::PgPool;
use tracing::info;

use crate::auth::password::hash_password;

/// Seeds the superadmin user if one does not already exist.
///
/// Reads credentials from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` env vars,
/// falling back to development defaults when unset.
pub async fn seed_superadmin(pool: &PgPool) -> Result<()> {
    let email = std::env::var("SUPERADMIN_EMAIL")
        .unwrap_or_else(|_| "admin@vandev.mx".to_string());
    let password = std::env::var("SUPERADMIN_PASSWORD")
        .unwrap_or_else(|_| "admin123".to_string());

    // Idempotent check — skip if superadmin already exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(pool)
    .await?;

    if existing > 0 {
        info!("Superadmin already exists, skipping seed");
        return Ok(());
    }

    let password_hash = hash_password(&password)?;

    sqlx::query(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'superadmin')",
    )
    .bind(&email)
    .bind(&password_hash)
    .bind("Super Admin")
    .execute(pool)
    .await?;

    info!("Superadmin seeded: {}", email);
    Ok(())
}
