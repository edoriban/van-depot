use std::env;

use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use vandepot_api::{app_router, state};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // Two-pool boot (Phase C polish — multi-tenant-foundation):
    //
    // * `DATABASE_URL` connects as the superuser `vandepot` and is used ONLY
    //   for migrations + seed. Postgres superusers BYPASS RLS regardless of
    //   `FORCE ROW LEVEL SECURITY`, so this pool MUST NOT serve runtime
    //   traffic.
    // * `DATABASE_URL_APP` connects as the non-superuser `vandepot_app`
    //   (created by migration `20260509000002_create_app_role.sql`) and is
    //   used to serve every authenticated request. Because the role is not
    //   a superuser, RLS policies actually bind it.
    //
    // We fail fast at boot if `DATABASE_URL_APP` is unset — silently falling
    // back to `DATABASE_URL` would erase the security guarantee without any
    // visible signal.
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let app_database_url = env::var("DATABASE_URL_APP").expect(
        "DATABASE_URL_APP must be set — this is the non-superuser runtime role so RLS fires. \
         See migration 20260509000002_create_app_role.sql.",
    );
    let redis_url =
        env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6381".to_string());

    // ── Phase 1: migrations + seed (superuser pool) ────────────────────────
    let migrations_pool = vandepot_infra::db::create_pool(&database_url).await?;
    tracing::info!("migrations pool connected (role=DATABASE_URL, used for migrate+seed only)");

    vandepot_infra::db::run_migrations(&migrations_pool).await?;

    // Env-gated superadmin bootstrap. Hardcoded credentials were removed; the
    // process exits non-zero if RUN_SEED_SUPERADMIN=true but env config is
    // missing or weak — see infra::seed::bootstrap_superadmin.
    if let Err(err) = vandepot_infra::seed::bootstrap_superadmin(&migrations_pool).await {
        eprintln!("FATAL: superadmin bootstrap failed: {err}");
        std::process::exit(1);
    }

    // Env-gated dev-only default tenant bootstrap. Off by default; `make
    // reset-db` flips both RUN_SEED_SUPERADMIN and RUN_SEED_DEFAULT_TENANT to
    // true so a fresh dev DB ends up with a single tenant + the superadmin.
    if let Err(err) = vandepot_infra::seed::seed_default_tenant_for_dev(&migrations_pool).await {
        eprintln!("FATAL: default tenant seed failed: {err}");
        std::process::exit(1);
    }

    // Demo seed is per-tenant via POST /admin/tenants/{id}/seed-demo (Phase D).
    // The handler calls `vandepot_infra::seed::seed_demo_for_tenant` inside the
    // admin per-request transaction (which has `app.is_superadmin='true'`
    // planted, so RLS WITH CHECK accepts the inserts). MUST NOT run at boot.

    // Drop the migrations pool — no further superuser DB access until next
    // boot. Active connections close as the PgPool is dropped.
    drop(migrations_pool);
    tracing::info!("migrations pool dropped (superuser access closed for runtime)");

    // ── Phase 2: app pool (non-superuser, RLS-bound) ──────────────────────
    let pool = vandepot_infra::db::create_pool(&app_database_url).await?;
    tracing::info!(
        "app pool connected (role=DATABASE_URL_APP, RLS enforced — not a superuser)"
    );

    let redis = vandepot_infra::redis::create_redis_pool(&redis_url).await?;
    let jwt_config = vandepot_infra::auth::jwt::JwtConfig::from_env()?;

    let state = state::AppState {
        pool,
        redis,
        jwt_config,
    };

    let app = app_router(state).layer(CorsLayer::permissive());

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
