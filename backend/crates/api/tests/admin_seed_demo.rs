// Integration test for `POST /admin/tenants/{id}/seed-demo` (Phase D).
//
// Source of truth:
// - Spec: `sdd/multi-tenant-foundation/spec` ("Demo Seed").
// - Design: `sdd/multi-tenant-foundation/design` §8.3.
// - Tasks: `sdd/multi-tenant-foundation/tasks` D2.
//
// Run command:
//   cargo test --workspace --test admin_seed_demo
//
// Skip behavior: tests skip cleanly when DATABASE_URL/REDIS_URL are absent
// (mirrors the harness in admin_impersonate.rs).
//
// What this proves end-to-end:
//   1. Superadmin POSTs /admin/tenants/{id}/seed-demo
//   2. Response carries a non-empty SeedSummary (warehouses ≥ 2, products ≥ 1)
//      for a freshly-created tenant
//   3. Re-running on the same tenant returns all-zero summary (idempotency)
//   4. An `audit_log` row with event='tenant.seed_demo' is queryable
//   5. Nonexistent tenant id → 404
//   6. Suspended tenant → 404

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::PgPool;
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

use vandepot_api::{app_router, state::AppState};
use vandepot_infra::auth::jwt::{create_access_token, JwtConfig};
use vandepot_infra::db::with_bypass_session;
use vandepot_infra::seed::replicate_stock_config_for_tenant;

const TEST_JWT_SECRET: &str = "test-secret-for-integration-only";

async fn maybe_state() -> Option<AppState> {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();
    let database_url = env::var("DATABASE_URL").ok()?;
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6381".to_string());
    let pool = PgPool::connect(&database_url).await.ok()?;
    let redis = vandepot_infra::redis::create_redis_pool(&redis_url).await.ok()?;
    let jwt_config = JwtConfig {
        secret: TEST_JWT_SECRET.to_string(),
        access_expiration: 900,
        refresh_expiration: 604_800,
        intermediate_expiration: 60,
    };
    Some(AppState { pool, redis, jwt_config })
}

macro_rules! state_or_skip {
    () => {
        match maybe_state().await {
            Some(s) => s,
            None => {
                eprintln!("SKIP: no DATABASE_URL/REDIS_URL available");
                return;
            }
        }
    };
}

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("superadmin seed must exist — run `make reset-db`");
    row.0
}

/// Seed an active target tenant (also replicates stock_configuration so RLS
/// downstream queries don't trip on the missing default row).
async fn seed_target_tenant(pool: &PgPool, slug: &str, name: &str) -> Uuid {
    let id = Uuid::new_v4();
    let slug_owned = slug.to_string();
    let name_owned = name.to_string();
    with_bypass_session(pool, async move |conn| {
        sqlx::query(
            "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
        )
        .bind(id)
        .bind(&slug_owned)
        .bind(&name_owned)
        .execute(&mut *conn)
        .await?;

        // Replicate the per-tenant stock_configuration default row so the
        // tenant fixture matches what `tenant_repo::create` produces. The
        // helper is idempotent and is the canonical replicator (see B8).
        replicate_stock_config_for_tenant(&mut *conn, id)
            .await
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        Ok(())
    })
    .await
    .expect("seed target tenant");
    id
}

/// Strip every demo row associated with `tenant_id` so the test doesn't leave
/// debris in the dev DB. We tear down in FK-safe order under the bypass
/// session because the rows are RLS-bound.
async fn cleanup_tenant(pool: &PgPool, tenant_id: Uuid) {
    let _ = with_bypass_session(pool, async move |conn| {
        // Audit rows reference target_tenant_id with ON DELETE SET NULL,
        // but we delete them explicitly to keep the table tidy.
        sqlx::query("DELETE FROM audit_log WHERE target_tenant_id = $1")
            .bind(tenant_id)
            .execute(&mut *conn)
            .await?;

        // Memberships for this tenant.
        sqlx::query("DELETE FROM user_tenants WHERE tenant_id = $1")
            .bind(tenant_id)
            .execute(&mut *conn)
            .await?;

        // Domain rows — order matters because of FK chains.
        for table in [
            "work_order_materials",
            "work_orders",
            "recipe_items",
            "recipes",
            "cycle_count_items",
            "cycle_counts",
            "purchase_order_lines",
            "purchase_orders",
            "notifications",
            "inventory_lots",
            "inventory",
            "product_lots",
            "movements",
            "supplier_products",
            "products",
            "categories",
            "suppliers",
            "user_warehouses",
            "tool_instances",
            "locations",
            "warehouses",
            "stock_configuration",
        ] {
            let sql = format!("DELETE FROM {table} WHERE tenant_id = $1");
            sqlx::query(&sql).bind(tenant_id).execute(&mut *conn).await?;
        }

        sqlx::query("DELETE FROM tenants WHERE id = $1")
            .bind(tenant_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
    .await;
}

#[tokio::test]
async fn superadmin_seeds_tenant_and_idempotent_re_run_returns_zero_counts() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let target_id = seed_target_tenant(
        &state.pool,
        &format!("seed-{suffix}"),
        "Seed Demo Target",
    )
    .await;

    let admin_id = superadmin_id(&state.pool).await;
    let admin_token =
        create_access_token(&state.jwt_config, admin_id, "admin@seed.test", None, true, None)
            .expect("mint admin token");

    // ── First call: warehouses + products etc. inserted ───────────────
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{target_id}/seed-demo"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    let status = resp.status();
    let body = body_json(resp).await;
    assert_eq!(status, StatusCode::OK, "body={body}");

    let summary = body.get("summary").expect("summary in body");
    let warehouses = summary["warehouses"].as_u64().unwrap_or(0);
    let products = summary["products"].as_u64().unwrap_or(0);
    let demo_users = summary["demo_users"].as_u64().unwrap_or(0);
    let memberships = summary["memberships"].as_u64().unwrap_or(0);
    assert!(
        warehouses >= 2,
        "expected ≥ 2 warehouses on first seed, got {warehouses}; full body: {body}"
    );
    assert!(
        products >= 15,
        "expected ≥ 15 products on first seed, got {products}; full body: {body}"
    );
    assert_eq!(memberships, 3, "expected 3 demo memberships granted");
    assert!(demo_users <= 3, "demo_users counter must be ≤ 3 (some may already exist globally), got {demo_users}");

    // tenant block in response.
    let tenant_block = body.get("tenant").expect("tenant in body");
    assert_eq!(tenant_block["id"].as_str().unwrap(), target_id.to_string());

    // ── Second call: every counter zero (idempotency) ────────────────
    let app2 = app_router(state.clone());
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{target_id}/seed-demo"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp2 = app2.oneshot(req2).await.expect("oneshot");
    let status2 = resp2.status();
    let body2 = body_json(resp2).await;
    assert_eq!(status2, StatusCode::OK, "body={body2}");
    let summary2 = body2.get("summary").expect("summary in body");
    for field in [
        "warehouses",
        "locations",
        "categories",
        "suppliers",
        "products",
        "recipes",
        "work_orders",
        "purchase_orders",
        "cycle_counts",
        "notifications",
        "demo_users",
        "memberships",
    ] {
        let v = summary2[field].as_u64().unwrap_or(u64::MAX);
        assert_eq!(
            v, 0,
            "expected idempotent re-run to insert 0 rows in `{field}` (got {v}); body={body2}"
        );
    }

    // ── Audit row: 2 rows for the 2 calls. ───────────────────────────
    let audit_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log \
         WHERE event = 'tenant.seed_demo' \
           AND target_tenant_id = $1 \
           AND actor_user_id = $2",
    )
    .bind(target_id)
    .bind(admin_id)
    .fetch_one(&state.pool)
    .await
    .expect("audit query");
    assert_eq!(audit_count.0, 2, "expected 2 audit rows for 2 seed calls");

    cleanup_tenant(&state.pool, target_id).await;
}

#[tokio::test]
async fn seed_demo_404_for_nonexistent_tenant() {
    let state = state_or_skip!();
    let admin_id = superadmin_id(&state.pool).await;
    let admin_token =
        create_access_token(&state.jwt_config, admin_id, "admin@seed.test", None, true, None)
            .expect("mint admin token");

    let bogus_id = Uuid::new_v4();
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{bogus_id}/seed-demo"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "nonexistent tenant must yield 404"
    );
}

#[tokio::test]
async fn seed_demo_404_for_suspended_tenant() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let target_id = seed_target_tenant(
        &state.pool,
        &format!("susp-{suffix}"),
        "Suspended Tenant",
    )
    .await;

    // Flip to suspended.
    let _ = with_bypass_session(&state.pool, async move |conn| {
        sqlx::query("UPDATE tenants SET status = 'suspended' WHERE id = $1")
            .bind(target_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
    .await;

    let admin_id = superadmin_id(&state.pool).await;
    let admin_token =
        create_access_token(&state.jwt_config, admin_id, "admin@seed.test", None, true, None)
            .expect("mint admin token");

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{target_id}/seed-demo"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "suspended tenant must yield 404 (uniform admin-route shape)"
    );

    cleanup_tenant(&state.pool, target_id).await;
}
