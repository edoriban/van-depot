// Phase E (multi-tenant-foundation) — task E3.
// In-tenant role denial matrix.
//
// Source of truth:
// - Spec:    `sdd/multi-tenant-foundation/spec` ("User-Tenant Membership and
//            Roles", scenario "A user with multiple memberships keeps distinct
//            roles" — owner-only operations on a tenant where the user is
//            operator MUST be denied with 403).
// - Design:  `sdd/multi-tenant-foundation/design` §7 (role guard semantics).
// - Tasks:   `sdd/multi-tenant-foundation/tasks` E3.
//
// Run command:
//   cargo test --workspace --test role_isolation
//
// Skip behavior: tests skip cleanly when DATABASE_URL/REDIS_URL are absent.
//
// ## Role permission matrix exercised here
//
// (Source: actual `require_role_claims(...)` calls in
//  crates/api/src/routes/{warehouses,products,categories,work_orders,movements,
//  recipes,suppliers}.rs as of Phase E entry.)
//
// | Action                            | owner | manager | operator | source         |
// |-----------------------------------|-------|---------|----------|----------------|
// | POST   /warehouses                | 201   | 403     | 403      | warehouses:139 |
// | PUT    /warehouses/{id}           | 200   | 403     | 403      | warehouses:264 |
// | DELETE /warehouses/{id}           | 403   | 403     | 403      | warehouses:289 (superadmin-only via `&[]`) |
// | POST   /categories                | 201   | 403     | 403      | categories:92  |
// | POST   /products                  | 201   | 201     | 403      | products:185   |
// | DELETE /products/{id}             | 200/204 | 403   | 403      | products:303   |
// | POST   /movements/entry           | (all)| (all)  | (all)    | movements (no role guard) |
// | POST   /work-orders               | 201   | 201     | 201      | work_orders:214 |
// | GET    /warehouses                | 200   | 200     | 200      | warehouses (no guard on list) |
//
// "(all)" = no `require_role_claims` call on the handler — the only gate is
// tenant membership + `Tenant` extractor membership re-check.

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

use vandepot_api::{app_router, state::AppState};
use vandepot_infra::auth::jwt::{create_access_token, JwtConfig};
use vandepot_infra::auth::password::hash_password;
use vandepot_infra::auth::tenant_context::TenantRole;
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

fn mint_token(state: &AppState, user_id: Uuid, email: &str, tenant_id: Uuid, role: TenantRole) -> String {
    create_access_token(
        &state.jwt_config,
        user_id,
        email,
        Some(tenant_id),
        false,
        Some(role),
    )
    .expect("token mint")
}

/// Seed a tenant + 3 users (owner / manager / operator). All inserts run under
/// `with_bypass_session` so RLS does not block the fixture work.
struct RoleSet {
    tenant_id: Uuid,
    owner: (Uuid, String),
    manager: (Uuid, String),
    operator: (Uuid, String),
}

async fn seed_role_set(state: &AppState, suffix: &str) -> RoleSet {
    let tenant_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let manager_id = Uuid::new_v4();
    let operator_id = Uuid::new_v4();
    let pw_hash = hash_password("Correct-Horse-Battery-9").expect("hash");
    let suffix = suffix.to_string();
    let owner_email = format!("e3-owner-{suffix}@iso.test");
    let manager_email = format!("e3-manager-{suffix}@iso.test");
    let operator_email = format!("e3-operator-{suffix}@iso.test");
    let oe = owner_email.clone();
    let me = manager_email.clone();
    let pe = operator_email.clone();

    with_bypass_session(&state.pool, async move |conn| {
        sqlx::query("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')")
            .bind(tenant_id)
            .bind(format!("e3-{suffix}"))
            .bind(format!("Iso Role Tenant {suffix}"))
            .execute(&mut *conn)
            .await?;
        replicate_stock_config_for_tenant(&mut *conn, tenant_id)
            .await
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

        for (uid, email, role_str) in [
            (owner_id, oe.as_str(), "owner"),
            (manager_id, me.as_str(), "manager"),
            (operator_id, pe.as_str(), "operator"),
        ] {
            sqlx::query(
                "INSERT INTO users (id, email, name, password_hash, is_active, is_superadmin, must_set_password) \
                 VALUES ($1, $2, 'Iso Role User', $3, true, false, false)",
            )
            .bind(uid)
            .bind(email)
            .bind(&pw_hash)
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3::tenant_role)",
            )
            .bind(uid)
            .bind(tenant_id)
            .bind(role_str)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    })
    .await
    .expect("seed_role_set tx");

    let owner_token = mint_token(state, owner_id, &owner_email, tenant_id, TenantRole::Owner);
    let manager_token = mint_token(state, manager_id, &manager_email, tenant_id, TenantRole::Manager);
    let operator_token = mint_token(state, operator_id, &operator_email, tenant_id, TenantRole::Operator);

    RoleSet {
        tenant_id,
        owner: (owner_id, owner_token),
        manager: (manager_id, manager_token),
        operator: (operator_id, operator_token),
    }
}

async fn cleanup(pool: &PgPool, tenant_id: Uuid, user_ids: &[Uuid]) {
    let user_ids = user_ids.to_vec();
    let _ = with_bypass_session(pool, async move |conn| {
        for table in [
            "work_order_materials",
            "work_orders",
            "movements",
            "products",
            "categories",
            "warehouses",
            "stock_configuration",
            "user_tenants",
        ] {
            let sql = format!("DELETE FROM {table} WHERE tenant_id = $1");
            sqlx::query(&sql).bind(tenant_id).execute(&mut *conn).await?;
        }
        sqlx::query("DELETE FROM tenants WHERE id = $1")
            .bind(tenant_id)
            .execute(&mut *conn)
            .await?;
        for uid in &user_ids {
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(uid)
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    })
    .await;
}

async fn http_post(state: &AppState, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    let status = resp.status();
    (status, body_json(resp).await)
}

async fn http_method(state: &AppState, method: &str, uri: &str, token: &str) -> StatusCode {
    let app = app_router(state.clone());
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    app.oneshot(req).await.expect("oneshot").status()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// Operator must NOT be allowed to create a warehouse (owner-only).
/// Manager must also be denied — warehouses.rs:139 hard-locks creation to
/// `&[TenantRole::Owner]`.
#[tokio::test]
async fn warehouse_create_owner_only() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    // Owner can create.
    let (s_owner, b_owner) = http_post(
        &state,
        "/warehouses",
        &rs.owner.1,
        json!({ "name": format!("Owner Wh {suffix}") }),
    )
    .await;
    assert_eq!(s_owner, StatusCode::CREATED, "owner create wh: {b_owner}");

    // Manager denied (owner-only on warehouse create).
    let (s_mgr, b_mgr) = http_post(
        &state,
        "/warehouses",
        &rs.manager.1,
        json!({ "name": format!("Mgr Wh {suffix}") }),
    )
    .await;
    assert_eq!(
        s_mgr,
        StatusCode::FORBIDDEN,
        "manager create wh must be 403 (owner-only): {b_mgr}"
    );

    // Operator denied.
    let (s_op, b_op) = http_post(
        &state,
        "/warehouses",
        &rs.operator.1,
        json!({ "name": format!("Op Wh {suffix}") }),
    )
    .await;
    assert_eq!(
        s_op,
        StatusCode::FORBIDDEN,
        "operator create wh must be 403: {b_op}"
    );

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// DELETE /warehouses/{id} requires SUPERADMIN per warehouses.rs:289
/// (`require_role_claims(&claims, &[])?` — empty allowlist, only superadmin
/// shortcircuits). All three tenant roles must be denied with 403.
#[tokio::test]
async fn warehouse_delete_superadmin_only() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    // Owner first creates a target warehouse.
    let (s_create, b_create) = http_post(
        &state,
        "/warehouses",
        &rs.owner.1,
        json!({ "name": format!("Doomed {suffix}") }),
    )
    .await;
    assert_eq!(s_create, StatusCode::CREATED, "owner create wh: {b_create}");
    let wh_id = b_create["id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .expect("id in create resp");

    // All three tenant roles denied.
    for (label, token) in [
        ("owner", &rs.owner.1),
        ("manager", &rs.manager.1),
        ("operator", &rs.operator.1),
    ] {
        let s = http_method(&state, "DELETE", &format!("/warehouses/{wh_id}"), token).await;
        assert_eq!(
            s,
            StatusCode::FORBIDDEN,
            "{label} DELETE wh must be 403 (superadmin-only)"
        );
    }

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// Read endpoints (GET /warehouses) must succeed for all three roles. The
/// `Tenant` extractor verifies membership; no role guard fires on listing.
/// (Note: warehouses listing additionally filters by `user_warehouses`; with
/// no assignments, all three roles get an empty list — but the response is
/// still 200, which is what we assert.)
#[tokio::test]
async fn warehouse_list_visible_to_all_roles() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    for (label, token) in [
        ("owner", &rs.owner.1),
        ("manager", &rs.manager.1),
        ("operator", &rs.operator.1),
    ] {
        let s = http_method(&state, "GET", "/warehouses?per_page=1", token).await;
        assert_eq!(s, StatusCode::OK, "{label} GET wh must 200");
    }

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// Category create is owner-only (categories.rs:92). Manager + operator → 403.
#[tokio::test]
async fn category_create_owner_only() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    let (s_owner, b_owner) = http_post(
        &state,
        "/categories",
        &rs.owner.1,
        json!({ "name": format!("OwnerCat {suffix}") }),
    )
    .await;
    assert_eq!(s_owner, StatusCode::CREATED, "owner create cat: {b_owner}");

    for (label, token) in [("manager", &rs.manager.1), ("operator", &rs.operator.1)] {
        let (s, b) = http_post(
            &state,
            "/categories",
            token,
            json!({ "name": format!("{label}Cat {suffix}") }),
        )
        .await;
        assert_eq!(
            s,
            StatusCode::FORBIDDEN,
            "{label} create cat must be 403 (owner-only): {b}"
        );
    }

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// Product create allows owner + manager (products.rs:185 — `[Owner, Manager]`);
/// operator → 403.
#[tokio::test]
async fn product_create_owner_or_manager() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    // Owner creates a category we'll reuse.
    let (s_cat, b_cat) = http_post(
        &state,
        "/categories",
        &rs.owner.1,
        json!({ "name": format!("Cat {suffix}") }),
    )
    .await;
    assert_eq!(s_cat, StatusCode::CREATED, "owner cat create: {b_cat}");
    let cat_id = b_cat["id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .expect("category id");

    let payload = |sku: &str| -> Value {
        json!({
            "name": format!("Prod {sku}"),
            "sku": sku,
            "unit_of_measure": "piece",
            "category_id": cat_id,
            "product_class": "consumable",
            "has_expiry": false,
            "min_stock": 0,
            "max_stock": 100,
        })
    };

    // Owner allowed.
    let (s_o, b_o) = http_post(&state, "/products", &rs.owner.1, payload(&format!("OWN-{suffix}"))).await;
    assert_eq!(s_o, StatusCode::CREATED, "owner create prod: {b_o}");

    // Manager allowed.
    let (s_m, b_m) = http_post(&state, "/products", &rs.manager.1, payload(&format!("MGR-{suffix}"))).await;
    assert_eq!(s_m, StatusCode::CREATED, "manager create prod: {b_m}");

    // Operator denied.
    let (s_p, b_p) = http_post(&state, "/products", &rs.operator.1, payload(&format!("OP-{suffix}"))).await;
    assert_eq!(
        s_p,
        StatusCode::FORBIDDEN,
        "operator create prod must be 403: {b_p}"
    );

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// DELETE /products/{id} is owner-only (products.rs:303). Manager + operator → 403.
#[tokio::test]
async fn product_delete_owner_only() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    // Owner sets up a category + product to delete.
    let (_, b_cat) = http_post(
        &state,
        "/categories",
        &rs.owner.1,
        json!({ "name": format!("Cat {suffix}") }),
    )
    .await;
    let cat_id = b_cat["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()).unwrap();
    let (_, b_prod) = http_post(
        &state,
        "/products",
        &rs.owner.1,
        json!({
            "name": format!("Prod {suffix}"),
            "sku": format!("DEL-{suffix}"),
            "unit_of_measure": "piece",
            "category_id": cat_id,
            "product_class": "consumable",
            "has_expiry": false,
            "min_stock": 0,
            "max_stock": 100,
        }),
    )
    .await;
    let prod_id = b_prod["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()).unwrap();

    // Manager denied.
    let s_mgr = http_method(&state, "DELETE", &format!("/products/{prod_id}"), &rs.manager.1).await;
    assert_eq!(s_mgr, StatusCode::FORBIDDEN, "manager DELETE product must be 403");

    // Operator denied.
    let s_op = http_method(&state, "DELETE", &format!("/products/{prod_id}"), &rs.operator.1).await;
    assert_eq!(s_op, StatusCode::FORBIDDEN, "operator DELETE product must be 403");

    // Owner allowed (last so we don't 404 the others).
    let s_owner = http_method(&state, "DELETE", &format!("/products/{prod_id}"), &rs.owner.1).await;
    assert!(
        s_owner.is_success(),
        "owner DELETE product must succeed; got {s_owner}"
    );

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}

/// Work-order create allows owner + manager + operator (work_orders.rs:214 —
/// `[Owner, Manager, Operator]`). Spec contract: operators can dispatch
/// production. Verifies the role guard at least admits all three; we don't
/// assert a 201 because the upstream business invariants (recipe, warehouse)
/// require setup that is out of scope for a permission-only test. Instead, we
/// assert that the response is NOT 403 (i.e. the role guard didn't reject).
#[tokio::test]
async fn work_order_create_allowed_for_all_roles() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let rs = seed_role_set(&state, &suffix).await;

    // Send a syntactically valid but business-invalid payload (recipe_id +
    // warehouse_id are unknown). We expect 4xx but specifically NOT 403 from
    // the role guard. A 404 / 422 / 409 is fine — those come from the handler
    // body, after the guard.
    let payload = json!({
        "recipe_id": Uuid::new_v4(),
        "warehouse_id": Uuid::new_v4(),
        "quantity": 1.0,
        "scheduled_date": "2026-12-31",
    });

    for (label, token) in [
        ("owner", &rs.owner.1),
        ("manager", &rs.manager.1),
        ("operator", &rs.operator.1),
    ] {
        let (s, b) = http_post(&state, "/work-orders", token, payload.clone()).await;
        assert_ne!(
            s,
            StatusCode::FORBIDDEN,
            "{label} create work-order MUST NOT be 403 (all 3 roles allowed); body={b}"
        );
    }

    cleanup(&state.pool, rs.tenant_id, &[rs.owner.0, rs.manager.0, rs.operator.0]).await;
}
