// Integration test for `POST /admin/tenants/{id}/impersonate` (Phase C7).
//
// Source of truth:
// - Spec: `sdd/multi-tenant-foundation/spec` ("Superadmin Powers" — scenario
//   "Impersonation mints a scoped token and audits").
// - Design: `sdd/multi-tenant-foundation/design` §6 (token shape) and §7
//   (audit log).
//
// Run command:
//   cargo test --workspace --test admin_impersonate
//
// Skip behavior: tests skip cleanly when DATABASE_URL/REDIS_URL are absent
// (mirrors the harness in product_classification.rs).
//
// What this proves end-to-end:
//   1. Superadmin POSTs /admin/tenants/{id}/impersonate
//   2. Response carries a JWT with `tenant_id == target` and
//      `is_superadmin == true`
//   3. `expires_at` is within 1..=60 minutes of issue time
//   4. An `audit_log` row with event='impersonation.minted' is queryable.

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::PgPool;
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

use vandepot_api::{app_router, state::AppState};
use vandepot_infra::auth::jwt::{create_access_token, validate_token, JwtConfig};
use vandepot_infra::db::with_bypass_session;

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

/// Look up the seeded superadmin id (created by `make reset-db`).
async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("superadmin seed must exist — run `make reset-db`");
    row.0
}

#[tokio::test]
async fn superadmin_impersonates_tenant_and_audit_row_persists() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();

    // Seed an active target tenant. Use bypass session because tenants is
    // exempt from RLS but writes through the seed path here are simplest.
    let target_tenant_id = Uuid::new_v4();
    with_bypass_session(&state.pool, async |conn| {
        sqlx::query(
            "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
        )
        .bind(target_tenant_id)
        .bind(format!("imp-{suffix}"))
        .bind("Impersonation Target")
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
    .expect("seed target tenant");

    // Mint a superadmin token (tenant_id = None, is_superadmin = true) using
    // the seeded superadmin id.
    let admin_id = superadmin_id(&state.pool).await;
    let admin_token = create_access_token(
        &state.jwt_config,
        admin_id,
        "admin@isolation.test",
        None,
        true,
        None,
    )
    .expect("mint admin token");

    // Hit the endpoint with the default body (15 min TTL).
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{target_tenant_id}/impersonate"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let issued_at = Utc::now();
    let resp = app.oneshot(req).await.expect("oneshot");

    let status = resp.status();
    let body = body_json(resp).await;
    assert_eq!(status, StatusCode::CREATED, "body={body}");

    // Decode the minted token. tenant_id must match target; is_superadmin
    // remains true; role is None.
    let access_token = body["access_token"].as_str().expect("access_token in body");
    let decoded = validate_token(&state.jwt_config, access_token).expect("decode minted token");
    assert_eq!(decoded.tenant_id, Some(target_tenant_id));
    assert!(decoded.is_superadmin);
    assert!(decoded.role.is_none());

    // expires_at is within 1..=60 minutes of issued_at. The default in the
    // handler is 15 minutes; keep the assertion loose to allow clock skew.
    let expires_at_str = body["expires_at"].as_str().expect("expires_at in body");
    let expires_at: DateTime<Utc> = expires_at_str.parse().expect("expires_at parses");
    let delta = (expires_at - issued_at).num_minutes();
    assert!(
        (1..=60).contains(&delta),
        "expected 1..=60 minutes between issued_at and expires_at; got {delta}"
    );

    // Audit row must be queryable. The endpoint commits the audit row in
    // the same tx so by the time we get here it's durable.
    let audit_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log \
         WHERE event = 'impersonation.minted' \
           AND target_tenant_id = $1 \
           AND actor_user_id = $2",
    )
    .bind(target_tenant_id)
    .bind(admin_id)
    .fetch_one(&state.pool)
    .await
    .expect("audit query");
    assert_eq!(
        audit_count.0, 1,
        "expected exactly 1 audit row for this impersonation"
    );

    // Cleanup. Audit row gets deleted by FK ON DELETE SET NULL when the
    // tenant goes — but to keep the table tidy we delete it explicitly so
    // re-runs don't leave orphan rows.
    let _ = with_bypass_session(&state.pool, async |conn| {
        sqlx::query(
            "DELETE FROM audit_log WHERE target_tenant_id = $1 AND actor_user_id = $2",
        )
        .bind(target_tenant_id)
        .bind(admin_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query("DELETE FROM stock_configuration WHERE tenant_id = $1")
            .bind(target_tenant_id)
            .execute(&mut *conn)
            .await?;
        sqlx::query("DELETE FROM tenants WHERE id = $1")
            .bind(target_tenant_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
    .await;
}

#[tokio::test]
async fn impersonate_rejects_excessive_ttl() {
    let state = state_or_skip!();

    // Seed an active target tenant — the bounds check happens AFTER the
    // tenant existence verify, so we still need a real target.
    let target_tenant_id = Uuid::new_v4();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    with_bypass_session(&state.pool, async |conn| {
        sqlx::query(
            "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
        )
        .bind(target_tenant_id)
        .bind(format!("imp-bad-{suffix}"))
        .bind("Impersonation TTL Out-of-Range")
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
    .expect("seed target tenant");

    let admin_id = superadmin_id(&state.pool).await;
    let admin_token =
        create_access_token(&state.jwt_config, admin_id, "admin@iso.test", None, true, None)
            .expect("token");

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/admin/tenants/{target_tenant_id}/impersonate"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::from(r#"{"ttl_minutes": 600}"#))
        .unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    assert_eq!(
        resp.status(),
        StatusCode::UNPROCESSABLE_ENTITY,
        "ttl > 60 minutes must be rejected"
    );

    let _ = with_bypass_session(&state.pool, async |conn| {
        sqlx::query("DELETE FROM stock_configuration WHERE tenant_id = $1")
            .bind(target_tenant_id)
            .execute(&mut *conn)
            .await?;
        sqlx::query("DELETE FROM tenants WHERE id = $1")
            .bind(target_tenant_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
    .await;
}
