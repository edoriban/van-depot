// Phase E (multi-tenant-foundation) — HTTP-layer cross-tenant isolation suite.
//
// Source of truth:
// - Spec:    `sdd/multi-tenant-foundation/spec` ("Tenant-Scoped Data Isolation"
//            requirement and the "Cross-Tenant Isolation Test Suite (CI Gate)").
// - Design:  `sdd/multi-tenant-foundation/design` §5 (per-request tx + RLS),
//            §6 (token shape), §7 (role guard).
// - Tasks:   `sdd/multi-tenant-foundation/tasks` E1, E2, E5.
//
// This file is the PRIMARY HTTP-layer defense.
//
// E1 helpers          — `seed_tenant_with_owner`, `seed_user_in_tenant`,
//                       `cleanup_tenants` (kept inline so cross-test reuse
//                       doesn't require a `support` mod + cargo cfg dance).
// E2 cross-tenant     — `seed-demo` populates Bob's tenant in one shot;
//                       Alice walks list / GET-by-id / PUT / DELETE / parent-
//                       id-in-POST-body against every tenant-scoped resource
//                       that ships an HTTP endpoint.
// E5 stale tokens     — (1) revoking a membership mid-session yields 401/403
//                       on the next request; (2) suspending a tenant causes
//                       `/auth/refresh` to fail with 403.
//
// Run command:
//   cargo test --workspace --test multi_tenant_isolation
//
// Skip behavior: tests skip cleanly when DATABASE_URL/REDIS_URL are absent
// (mirrors `admin_seed_demo.rs`).

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use http_body_util::BodyExt;
use redis::AsyncCommands;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

use vandepot_api::{app_router, state::AppState};
use vandepot_infra::auth::jwt::{create_access_token, create_refresh_token, JwtConfig};
use vandepot_infra::auth::password::hash_password;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::db::with_bypass_session;

// ─── Test harness ────────────────────────────────────────────────────────────

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
    if bytes.is_empty() { return Value::Null; }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("superadmin seed must exist — run `make reset-db`");
    row.0
}

// ─── E1: seeded-tenant fixture ───────────────────────────────────────────────

/// Result of `seed_tenant_with_owner`: a fresh tenant + its owner user + a
/// minted access token bound to the (user, tenant, owner) triple.
pub struct SeededTenant {
    pub tenant_id: Uuid,
    pub owner_user_id: Uuid,
    pub access_token: String,
    pub slug: String,
    pub email: String,
}

fn mint_token(state: &AppState, user_id: Uuid, email: &str, tenant_id: Uuid, role: TenantRole) -> String {
    create_access_token(&state.jwt_config, user_id, email, Some(tenant_id), false, Some(role))
        .expect("token mint")
}

/// Seed an active tenant + its owner user + grant `owner` membership +
/// replicate per-tenant stock_configuration. Returns a [`SeededTenant`] whose
/// access token is ready for tenant-scoped requests.
pub async fn seed_tenant_with_owner(state: &AppState, slug: &str, owner_email: &str) -> SeededTenant {
    use vandepot_infra::seed::replicate_stock_config_for_tenant;

    let tenant_id = Uuid::new_v4();
    let owner_user_id = Uuid::new_v4();
    let pw_hash = hash_password("Correct-Horse-Battery-9").expect("hash password");
    let slug_owned = slug.to_string();
    let email_owned = owner_email.to_string();

    with_bypass_session(&state.pool, async move |conn| {
        sqlx::query("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')")
            .bind(tenant_id)
            .bind(&slug_owned)
            .bind(format!("Iso Tenant {slug_owned}"))
            .execute(&mut *conn).await?;
        sqlx::query(
            "INSERT INTO users (id, email, name, password_hash, is_active, is_superadmin, must_set_password) \
             VALUES ($1, $2, 'Iso Owner', $3, true, false, false)",
        )
        .bind(owner_user_id).bind(&email_owned).bind(&pw_hash)
        .execute(&mut *conn).await?;
        sqlx::query("INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'owner')")
            .bind(owner_user_id).bind(tenant_id)
            .execute(&mut *conn).await?;
        replicate_stock_config_for_tenant(&mut *conn, tenant_id)
            .await
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        Ok(())
    })
    .await
    .expect("seed_tenant_with_owner: tx failed");

    let access_token = mint_token(state, owner_user_id, owner_email, tenant_id, TenantRole::Owner);

    SeededTenant {
        tenant_id, owner_user_id, access_token,
        slug: slug.to_string(), email: owner_email.to_string(),
    }
}

/// Create a user inside an existing tenant with the given role and mint an
/// access token for them. Returns `(user_id, access_token)`.
pub async fn seed_user_in_tenant(
    state: &AppState, tenant_id: Uuid, email: &str, role: TenantRole,
) -> (Uuid, String) {
    let user_id = Uuid::new_v4();
    let pw_hash = hash_password("Correct-Horse-Battery-9").expect("hash password");
    let email_owned = email.to_string();
    let role_str = match role {
        TenantRole::Owner => "owner",
        TenantRole::Manager => "manager",
        TenantRole::Operator => "operator",
    };

    with_bypass_session(&state.pool, async move |conn| {
        sqlx::query(
            "INSERT INTO users (id, email, name, password_hash, is_active, is_superadmin, must_set_password) \
             VALUES ($1, $2, 'Iso User', $3, true, false, false)",
        )
        .bind(user_id).bind(&email_owned).bind(&pw_hash)
        .execute(&mut *conn).await?;
        sqlx::query("INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3::tenant_role)")
            .bind(user_id).bind(tenant_id).bind(role_str)
            .execute(&mut *conn).await?;
        Ok(())
    })
    .await
    .expect("seed_user_in_tenant: tx failed");

    let access_token = mint_token(state, user_id, email, tenant_id, role);
    (user_id, access_token)
}

/// Best-effort cleanup. Deletes (in FK-safe order) every tenant-scoped row
/// belonging to the provided tenants, then memberships, then users, then the
/// tenants themselves.
pub async fn cleanup_tenants(state: &AppState, tenants: &[Uuid], users: &[Uuid]) {
    let tenants = tenants.to_vec();
    let users = users.to_vec();
    let _ = with_bypass_session(&state.pool, async move |conn| {
        for tid in &tenants {
            sqlx::query("DELETE FROM audit_log WHERE target_tenant_id = $1")
                .bind(tid).execute(&mut *conn).await?;
            for table in [
                "work_order_materials", "work_orders",
                "recipe_items", "recipes",
                "cycle_count_items", "cycle_counts",
                "purchase_return_items", "purchase_returns",
                "purchase_order_lines", "purchase_orders",
                "notifications",
                "inventory_lots", "inventory",
                "product_lots", "movements",
                "supplier_products", "products", "categories", "suppliers",
                "user_warehouses", "tool_instances",
                "locations", "warehouses",
                "stock_configuration", "user_tenants",
            ] {
                let sql = format!("DELETE FROM {table} WHERE tenant_id = $1");
                sqlx::query(&sql).bind(tid).execute(&mut *conn).await?;
            }
            sqlx::query("DELETE FROM tenants WHERE id = $1")
                .bind(tid).execute(&mut *conn).await?;
        }
        for uid in &users {
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(uid).execute(&mut *conn).await?;
        }
        Ok(())
    })
    .await;
}

// ─── E2 helpers ──────────────────────────────────────────────────────────────

async fn http_status(state: &AppState, method: &str, uri: &str, token: &str) -> StatusCode {
    let app = app_router(state.clone());
    let req = Request::builder().method(method).uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty()).unwrap();
    app.oneshot(req).await.expect("oneshot").status()
}

async fn http_json(state: &AppState, method: &str, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let app = app_router(state.clone());
    let req = Request::builder().method(method).uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string())).unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    let status = resp.status();
    (status, body_json(resp).await)
}

async fn seed_demo_into_tenant(state: &AppState, tenant_id: Uuid) {
    let admin = superadmin_id(&state.pool).await;
    let admin_token = create_access_token(&state.jwt_config, admin, "admin@iso.test", None, true, None)
        .expect("mint admin token");
    let app = app_router(state.clone());
    let req = Request::builder().method("POST")
        .uri(format!("/admin/tenants/{tenant_id}/seed-demo"))
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .header("content-type", "application/json")
        .body(Body::empty()).unwrap();
    let resp = app.oneshot(req).await.expect("oneshot");
    let status = resp.status();
    let body = body_json(resp).await;
    assert_eq!(status, StatusCode::OK, "seed-demo failed: {body}");
}

/// One representative id per tenant-scoped resource, fetched via direct DB
/// query under `with_bypass_session` (RLS off) so we always see Bob's rows.
#[derive(Default)]
struct BobIds {
    warehouse: Option<Uuid>,
    location: Option<Uuid>,
    category: Option<Uuid>,
    supplier: Option<Uuid>,
    product: Option<Uuid>,
    recipe: Option<Uuid>,
    work_order: Option<Uuid>,
    purchase_order: Option<Uuid>,
    purchase_order_line: Option<(Uuid, Uuid)>,
    cycle_count: Option<Uuid>,
    notification: Option<Uuid>,
    movement: Option<Uuid>,
    product_lot: Option<Uuid>,
}

async fn collect_bob_ids(pool: &PgPool, tenant_id: Uuid) -> BobIds {
    let mut ids = BobIds::default();
    let _ = with_bypass_session(pool, async |conn| {
        async fn one(conn: &mut sqlx::PgConnection, sql: &str, t: Uuid) -> Option<Uuid> {
            sqlx::query_as::<_, (Uuid,)>(sql).bind(t).fetch_optional(conn).await.ok().flatten().map(|r| r.0)
        }
        async fn pair(conn: &mut sqlx::PgConnection, sql: &str, t: Uuid) -> Option<(Uuid, Uuid)> {
            sqlx::query_as::<_, (Uuid, Uuid)>(sql).bind(t).fetch_optional(conn).await.ok().flatten()
        }
        ids.warehouse = one(&mut *conn, "SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.location = one(&mut *conn, "SELECT id FROM locations WHERE tenant_id = $1 AND location_type <> 'reception' LIMIT 1", tenant_id).await;
        ids.category = one(&mut *conn, "SELECT id FROM categories WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.supplier = one(&mut *conn, "SELECT id FROM suppliers WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.product = one(&mut *conn, "SELECT id FROM products WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.recipe = one(&mut *conn, "SELECT id FROM recipes WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.work_order = one(&mut *conn, "SELECT id FROM work_orders WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.purchase_order = one(&mut *conn, "SELECT id FROM purchase_orders WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.purchase_order_line = pair(&mut *conn, "SELECT purchase_order_id, id FROM purchase_order_lines WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.cycle_count = one(&mut *conn, "SELECT id FROM cycle_counts WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.notification = one(&mut *conn, "SELECT id FROM notifications WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.movement = one(&mut *conn, "SELECT id FROM movements WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        ids.product_lot = one(&mut *conn, "SELECT id FROM product_lots WHERE tenant_id = $1 LIMIT 1", tenant_id).await;
        Ok(())
    }).await;
    ids
}

/// Acceptable status codes for cross-tenant rejection on a write that targets
/// a foreign parent id. Per E2's locked decision: we accept 4xx in
/// {400, 403, 404, 409, 422} so the test is resilient to mapping flips
/// (e.g. RLS WITH CHECK 42501 → 403 vs composite-FK 23503 → 409).
fn assert_cross_write_rejected(status: StatusCode, label: &str, body: &Value) {
    assert!(status.is_client_error(), "{label}: expected 4xx, got {status}; body={body}");
    let ok = matches!(
        status,
        StatusCode::BAD_REQUEST | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
            | StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(ok, "{label}: expected 400/403/404/409/422, got {status}; body={body}");
}

/// Assert a no-leak read/write outcome: foreign id ⇒ 404 (or 403 for endpoints
/// that hit the warehouse-access guard / superadmin-only role first).
fn assert_no_leak(status: StatusCode, label: &str) {
    assert!(
        status == StatusCode::NOT_FOUND || status == StatusCode::FORBIDDEN,
        "{label}: expected 404 (or 403 for warehouse-access/superadmin endpoints), got {status}"
    );
}

// ─── E2 test ─────────────────────────────────────────────────────────────────

/// Combined cross-tenant matrix: seed Bob's tenant via `seed-demo`, then drive
/// Alice through every list / GET-by-id / UPDATE / DELETE / cross-ref-create
/// assertion in a single test function.
///
/// We collapse "21 cases" into one `#[tokio::test]` because seed-demo is
/// expensive (~1s end-to-end against a live DB); running it 21 times would
/// 20× the wall-clock cost. Test failures still pinpoint the offending verb +
/// resource because every assert message names them.
#[tokio::test]
async fn http_cross_tenant_matrix() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();

    let alice = seed_tenant_with_owner(
        &state, &format!("e2a-{suffix}"), &format!("alice-{suffix}@iso.test"),
    ).await;
    let bob = seed_tenant_with_owner(
        &state, &format!("e2b-{suffix}"), &format!("bob-{suffix}@iso.test"),
    ).await;

    seed_demo_into_tenant(&state, bob.tenant_id).await;
    let bids = collect_bob_ids(&state.pool, bob.tenant_id).await;

    // Sanity: the seed populates the major resources.
    assert!(bids.warehouse.is_some(), "seed should produce ≥ 1 warehouse");
    assert!(bids.product.is_some(),   "seed should produce ≥ 1 product");
    assert!(bids.category.is_some(),  "seed should produce ≥ 1 category");
    assert!(bids.supplier.is_some(),  "seed should produce ≥ 1 supplier");

    let at = alice.access_token.as_str();

    // ── 1. Lists: Alice's list of every tenant-scoped resource is empty. ──
    for (label, uri) in [
        ("warehouses",      "/warehouses?per_page=1000"),
        ("categories",      "/categories?per_page=1000"),
        ("suppliers",       "/suppliers?per_page=1000"),
        ("products",        "/products?per_page=1000"),
        ("recipes",         "/recipes?per_page=1000"),
        ("work-orders",     "/work-orders?per_page=1000"),
        ("purchase-orders", "/purchase-orders?per_page=1000"),
        ("cycle-counts",    "/cycle-counts?per_page=1000"),
        ("notifications",   "/notifications?per_page=1000"),
        ("inventory",       "/inventory?per_page=1000"),
        ("movements",       "/movements?per_page=1000"),
    ] {
        let app = app_router(state.clone());
        let req = Request::builder().method("GET").uri(uri)
            .header(AUTHORIZATION, format!("Bearer {at}"))
            .body(Body::empty()).unwrap();
        let resp = app.oneshot(req).await.expect("oneshot");
        let status = resp.status();
        let body = body_json(resp).await;
        assert!(status.is_success(), "GET {label} ({uri}): expected 2xx, got {status} body={body}");
        let data = body.get("data").or(Some(&body)).unwrap();
        let len = data.as_array().map(|a| a.len()).unwrap_or(0);
        assert_eq!(len, 0, "{label}: alice's list MUST be empty; got {len} items: {body}");
    }

    // ── 2. GET-by-id of foreign resource. ──────────────────────────────────
    let gets: &[(&str, Option<Uuid>, &str)] = &[
        ("/warehouses/{}",      bids.warehouse,      "GET /warehouses/:id"),
        ("/products/{}",        bids.product,        "GET /products/:id"),
        ("/recipes/{}",         bids.recipe,         "GET /recipes/:id"),
        ("/work-orders/{}",     bids.work_order,     "GET /work-orders/:id"),
        ("/purchase-orders/{}", bids.purchase_order, "GET /purchase-orders/:id"),
        ("/cycle-counts/{}",    bids.cycle_count,    "GET /cycle-counts/:id"),
        ("/movements/{}",       bids.movement,       "GET /movements/:id"),
        ("/lots/{}",            bids.product_lot,    "GET /lots/:id"),
    ];
    for (tmpl, opt_id, label) in gets {
        if let Some(id) = opt_id {
            let s = http_status(&state, "GET", &tmpl.replace("{}", &id.to_string()), at).await;
            assert_no_leak(s, label);
        }
    }

    // ── 3. UPDATE (PUT/PATCH) of foreign resource. ─────────────────────────
    let puts: &[(&str, Option<Uuid>, Value, &str)] = &[
        ("/warehouses/{}",  bids.warehouse, json!({"name": "alice-rename"}), "PUT /warehouses/:id"),
        ("/categories/{}",  bids.category,  json!({"name": "alice-rename"}), "PUT /categories/:id"),
        ("/products/{}",    bids.product,   json!({"name": "alice-rename"}), "PUT /products/:id"),
        ("/suppliers/{}",   bids.supplier,  json!({"name": "alice-rename"}), "PUT /suppliers/:id"),
        // PUT /recipes/{id} requires `{name, description, items}` so we send a
        // complete (but empty-items) body — JSON deser must accept it before
        // the route hits the cross-tenant lookup.
        ("/recipes/{}",     bids.recipe,
            json!({"name": "alice-rename", "description": null, "items": []}), "PUT /recipes/:id"),
    ];
    for (tmpl, opt_id, body, label) in puts {
        if let Some(id) = opt_id {
            let (s, b) = http_json(&state, "PUT", &tmpl.replace("{}", &id.to_string()), at, body.clone()).await;
            assert_no_leak(s, &format!("{label} body={b}"));
        }
    }

    // ── 4. DELETE foreign resource. ────────────────────────────────────────
    let deletes: &[(&str, Option<Uuid>, &str)] = &[
        ("/warehouses/{}", bids.warehouse, "DELETE /warehouses/:id"),
        ("/products/{}",   bids.product,   "DELETE /products/:id"),
        ("/categories/{}", bids.category,  "DELETE /categories/:id"),
        ("/recipes/{}",    bids.recipe,    "DELETE /recipes/:id"),
        ("/suppliers/{}",  bids.supplier,  "DELETE /suppliers/:id"),
    ];
    for (tmpl, opt_id, label) in deletes {
        if let Some(id) = opt_id {
            let s = http_status(&state, "DELETE", &tmpl.replace("{}", &id.to_string()), at).await;
            assert_no_leak(s, label);
        }
    }

    // PUT /notifications/{id}/read on foreign id → 404.
    if let Some(n_id) = bids.notification {
        let (s, _) = http_json(&state, "PUT", &format!("/notifications/{n_id}/read"), at, json!({})).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "PUT /notifications/{n_id}/read foreign → 404");
    }

    // DELETE PO line (nested resource).
    if let Some((po_id, line_id)) = bids.purchase_order_line {
        let s = http_status(&state, "DELETE", &format!("/purchase-orders/{po_id}/lines/{line_id}"), at).await;
        assert_no_leak(s, "DELETE /purchase-orders/:id/lines/:line_id (foreign)");
    }

    // ── 5. Cross-tenant references in POST body (parent-id leak attempts). ─
    let _alice_cat: Uuid = {
        let (s, b) = http_json(&state, "POST", "/categories", at,
            json!({"name": format!("alice-cat-{suffix}")})).await;
        assert_eq!(s, StatusCode::CREATED, "alice category create: {b}");
        b["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()).expect("alice category id")
    };

    if let Some(cat_b) = bids.category {
        let (s, b) = http_json(&state, "POST", "/products", at, json!({
            "name": format!("Sneaky {suffix}"), "sku": format!("X-CAT-{suffix}"),
            "unit_of_measure": "piece", "category_id": cat_b,
            "product_class": "consumable", "has_expiry": false,
            "min_stock": 0, "max_stock": 100,
        })).await;
        assert_cross_write_rejected(s, "POST /products w/ foreign category_id", &b);
    }

    if let Some(loc_b) = bids.location {
        // Alice has no locations, so `from` is a random uuid; the handler
        // resolves to_location FIRST inside the tenant — foreign location
        // surfaces from `get_location_meta`.
        let (s, b) = http_json(&state, "POST", "/movements/transfer", at, json!({
            "product_id": Uuid::new_v4(), "from_location_id": Uuid::new_v4(),
            "to_location_id": loc_b, "quantity": 1.0, "reference": null, "notes": null,
        })).await;
        assert_cross_write_rejected(s, "POST /movements/transfer w/ foreign to_location_id", &b);
    }

    if let Some(sup_b) = bids.supplier {
        let (s, b) = http_json(&state, "POST", "/supplier-products", at, json!({
            "supplier_id": sup_b, "product_id": Uuid::new_v4(),
            "supplier_sku": "X-SP", "unit_cost": 1.0,
        })).await;
        assert_cross_write_rejected(s, "POST /supplier-products w/ foreign supplier_id", &b);
    }

    if let (Some(wh_b), Some(rec_b)) = (bids.warehouse, bids.recipe) {
        let (s, b) = http_json(&state, "POST", "/work-orders", at, json!({
            "recipe_id": rec_b, "warehouse_id": wh_b,
            "quantity": 1.0, "scheduled_date": "2026-12-31",
        })).await;
        assert_cross_write_rejected(s, "POST /work-orders w/ foreign recipe_id+warehouse_id", &b);
    }

    if let Some(sup_b) = bids.supplier {
        let (s, b) = http_json(&state, "POST", "/purchase-orders", at, json!({
            "supplier_id": sup_b, "warehouse_id": Uuid::new_v4(),
            "expected_delivery_date": "2026-12-31", "notes": null, "lines": [],
        })).await;
        assert_cross_write_rejected(s, "POST /purchase-orders w/ foreign supplier_id", &b);
    }

    cleanup_tenants(&state, &[alice.tenant_id, bob.tenant_id], &[alice.owner_user_id, bob.owner_user_id]).await;
}

// ─── E5: stale tokens & suspended tenant ────────────────────────────────────

/// Scenario 1 — Membership revoked mid-session: bob is owner of acme. Issue a
/// token. Superadmin (via direct repo) revokes bob's membership. Bob's next
/// request must yield 401 or 403.
#[tokio::test]
async fn revoked_membership_yields_401_or_403_on_next_request() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let bob = seed_tenant_with_owner(
        &state, &format!("e5rev-{suffix}"), &format!("bob-rev-{suffix}@iso.test"),
    ).await;

    // Sanity: token works before revocation.
    let pre = http_status(&state, "GET", "/products?per_page=10", &bob.access_token).await;
    assert!(pre.is_success(), "pre-revocation: bob's token should work, got {pre}");

    // Revoke bob's membership directly via SQL (equivalent to a superadmin
    // calling DELETE /admin/tenants/{tid}/memberships/{uid}).
    let bob_user_id = bob.owner_user_id;
    let tenant_id = bob.tenant_id;
    let _ = with_bypass_session(&state.pool, async move |conn| {
        sqlx::query("UPDATE user_tenants SET revoked_at = NOW() WHERE user_id = $1 AND tenant_id = $2")
            .bind(bob_user_id).bind(tenant_id).execute(&mut *conn).await?;
        Ok(())
    }).await;

    // Tenant-scoped requests now reject with 401 or 403.
    let post = http_status(&state, "GET", "/products?per_page=10", &bob.access_token).await;
    assert!(
        post == StatusCode::UNAUTHORIZED || post == StatusCode::FORBIDDEN,
        "post-revocation: expected 401/403, got {post}"
    );

    cleanup_tenants(&state, &[bob.tenant_id], &[bob.owner_user_id]).await;
}

/// Scenario 2 — Tenant suspended ⇒ /auth/refresh returns 403. The refresh
/// handler re-verifies membership, and `verify_membership` requires the tenant
/// to be `status='active' AND deleted_at IS NULL`.
#[tokio::test]
async fn suspended_tenant_rejects_refresh_with_403() {
    let state = state_or_skip!();
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let bob = seed_tenant_with_owner(
        &state, &format!("e5sus-{suffix}"), &format!("bob-sus-{suffix}@iso.test"),
    ).await;

    // Mint a refresh token and stash it under the canonical Redis key.
    let refresh_token = create_refresh_token(
        &state.jwt_config, bob.owner_user_id, &bob.email,
        Some(bob.tenant_id), false, Some(TenantRole::Owner),
    ).expect("mint refresh");

    let mut conn = state.redis.clone();
    let key = format!("refresh:{}", bob.owner_user_id);
    let _: () = conn.set::<_, _, ()>(&key, &refresh_token).await.expect("redis set refresh");

    // Sanity: refresh succeeds before suspension.
    let (pre_s, pre_b) = http_json(&state, "POST", "/auth/refresh", "",
        json!({"refresh_token": refresh_token})).await;
    assert_eq!(pre_s, StatusCode::OK, "pre-suspension refresh should succeed; body={pre_b}");
    let new_refresh = pre_b["refresh_token"].as_str().expect("refresh_token in response").to_string();

    // Suspend acme via direct UPDATE (equivalent to PATCH /admin/tenants/{id}).
    let tenant_id = bob.tenant_id;
    let _ = with_bypass_session(&state.pool, async move |conn| {
        sqlx::query("UPDATE tenants SET status = 'suspended' WHERE id = $1")
            .bind(tenant_id).execute(&mut *conn).await?;
        Ok(())
    }).await;

    // Refresh must now fail with 403.
    let (post_s, post_b) = http_json(&state, "POST", "/auth/refresh", "",
        json!({"refresh_token": new_refresh})).await;
    assert_eq!(
        post_s, StatusCode::FORBIDDEN,
        "post-suspension refresh must yield 403; body={post_b}"
    );

    let _: () = conn.del::<_, ()>(&key).await.unwrap_or(());
    cleanup_tenants(&state, &[bob.tenant_id], &[bob.owner_user_id]).await;
}
