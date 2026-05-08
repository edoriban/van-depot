// HTTP integration tests for the Product Classification change.
//
// Phase 6 task coverage:
//   6.3  — Create + GET round-trip per class (product_class/has_expiry in DTO).
//   6.4  — POST /lots/receive matrix (3 classes × 2 expiry states, valid only).
//   6.5  — PO receive-line delegates to /lots/receive and propagates the
//          `kind` discriminator for each class.
//   6.6  — PATCH /products/{id}/class happy path + 409 with blocked_by counts.
//   6.7  — GET /products?class= filter returns only matching products.
//   6.8  — GET /products/{id}/class-lock probe (fresh vs locked).
//   6.9  — list-filter + existing-fields preserved.
//
// The "no route for /tool-instances" check from task 6.12 also lives here
// (router-level concern).
//
// Mirrors the harness style of `reception_flow_routes.rs`: tests skip cleanly
// when `DATABASE_URL` is unavailable and clean up on exit.

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
use vandepot_infra::auth::tenant_context::TenantRole;

// ─── Test harness (parallel to reception_flow_routes.rs) ─────────────

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

    Some(AppState {
        pool,
        redis,
        jwt_config,
    })
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

async fn mint_token(state: &AppState, user_id: Uuid, role: &str, _warehouse_ids: Vec<Uuid>) -> String {
    let (is_superadmin, tenant_role) = map_legacy_role(role);
    // Phase B B1: every test token attaches the dev tenant id so tenant-
    // scoped endpoints accept it. Pure-superadmin (tenant=None) tokens are
    // valid for /admin/* but not for /warehouses, /locations, etc.
    let tenant_id = Some(dev_tenant_id(&state.pool).await);
    create_access_token(
        &state.jwt_config,
        user_id,
        &format!("{role}@test.dev"),
        tenant_id,
        is_superadmin,
        tenant_role,
    )
    .expect("token mint")
}

async fn dev_tenant_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as(
        "SELECT id FROM tenants WHERE slug = 'dev' AND deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await
    .expect("dev tenant must exist — run `make reset-db`");
    row.0
}

fn map_legacy_role(role: &str) -> (bool, Option<TenantRole>) {
    match role {
        "superadmin" => (true, None),
        "owner" => (false, Some(TenantRole::Owner)),
        "warehouse_manager" => (false, Some(TenantRole::Manager)),
        "operator" => (false, Some(TenantRole::Operator)),
        other => panic!("unknown legacy role: {other}"),
    }
}

async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("superadmin seed must exist");
    row.0
}

struct Fixture {
    state: AppState,
    tenant_id: Uuid,
    warehouse_ids: Vec<Uuid>,
    product_ids: Vec<Uuid>,
    supplier_ids: Vec<Uuid>,
    po_ids: Vec<Uuid>,
}

impl Fixture {
    async fn new(state: AppState) -> Self {
        let tenant_id: (Uuid,) = sqlx::query_as(
            "SELECT id FROM tenants WHERE slug = 'dev' AND deleted_at IS NULL",
        )
        .fetch_one(&state.pool)
        .await
        .expect("dev tenant must exist — run `make reset-db`");
        Self {
            state,
            tenant_id: tenant_id.0,
            warehouse_ids: Vec::new(),
            product_ids: Vec::new(),
            supplier_ids: Vec::new(),
            po_ids: Vec::new(),
        }
    }

    async fn create_warehouse_direct(&mut self, name: &str) -> Uuid {
        use vandepot_infra::repositories::warehouse_repo;
        let mut conn = self.state.pool.acquire().await.expect("acquire conn");
        let wh = warehouse_repo::create(&mut conn, self.tenant_id, name, None)
            .await
            .expect("warehouse create");
        self.warehouse_ids.push(wh.id);
        wh.id
    }

    /// Create a product via direct SQL with explicit `product_class` +
    /// `has_expiry`. Skipping the HTTP layer keeps the fixture fast; the
    /// HTTP create path is exercised directly by 6.3.
    async fn create_product(
        &mut self,
        suffix: &str,
        class: &str,
        has_expiry: bool,
    ) -> Uuid {
        // Phase B B2: products carry NOT NULL tenant_id.
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO products (tenant_id, name, sku, unit_of_measure, product_class, has_expiry) \
             VALUES ($1, $2, $3, 'piece', $4::product_class, $5) \
             RETURNING id",
        )
        .bind(self.tenant_id)
        .bind(format!("Prod {suffix}"))
        .bind(format!("PCH-{suffix}"))
        .bind(class)
        .bind(has_expiry)
        .fetch_one(&self.state.pool)
        .await
        .expect("product insert");
        self.product_ids.push(row.0);
        row.0
    }

    async fn create_supplier(&mut self) -> Uuid {
        // Phase B B3: suppliers carry NOT NULL tenant_id.
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id",
        )
        .bind(self.tenant_id)
        .bind(format!("Sup {}", Uuid::new_v4()))
        .fetch_one(&self.state.pool)
        .await
        .expect("supplier insert");
        self.supplier_ids.push(row.0);
        row.0
    }

    async fn cleanup(&self) {
        for pid in &self.po_ids {
            let _ = sqlx::query(
                "DELETE FROM movements WHERE purchase_order_id = $1",
            )
            .bind(pid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query("DELETE FROM purchase_order_lines WHERE purchase_order_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM purchase_orders WHERE id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
        }
        for wid in &self.warehouse_ids {
            let _ = sqlx::query(
                "DELETE FROM movements \
                 WHERE from_location_id IN (SELECT id FROM locations WHERE warehouse_id = $1) \
                    OR to_location_id   IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM inventory_lots \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM inventory \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM tool_instances \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query("DELETE FROM locations WHERE warehouse_id = $1")
                .bind(wid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM warehouses WHERE id = $1")
                .bind(wid)
                .execute(&self.state.pool)
                .await;
        }
        for pid in &self.product_ids {
            let _ = sqlx::query("DELETE FROM tool_instances WHERE product_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM movements WHERE product_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM inventory WHERE product_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query(
                "DELETE FROM inventory_lots WHERE product_lot_id IN \
                    (SELECT id FROM product_lots WHERE product_id = $1)",
            )
            .bind(pid)
            .execute(&self.state.pool)
            .await;
            let _ = sqlx::query("DELETE FROM product_lots WHERE product_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM products WHERE id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
        }
        for sid in &self.supplier_ids {
            let _ = sqlx::query("DELETE FROM suppliers WHERE id = $1")
                .bind(sid)
                .execute(&self.state.pool)
                .await;
        }
    }
}

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

// ─── 6.3 — create + GET round-trip per class ─────────────────────────

#[tokio::test]
async fn test_6_3_create_and_get_product_round_trip_per_class() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    for (class, has_expiry) in [
        ("raw_material", false),
        ("consumable", false),
        ("consumable", true),
        ("tool_spare", false),
    ] {
        let app = app_router(state.clone());
        let sku = format!("E2E-{}-{}", class, &Uuid::new_v4().to_string()[..6]);
        let req = Request::builder()
            .method("POST")
            .uri("/products")
            .header("content-type", "application/json")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(
                json!({
                    "name": format!("Prod-{class}"),
                    "sku": sku,
                    "unit_of_measure": "piece",
                    "product_class": class,
                    "has_expiry": has_expiry,
                    "min_stock": 0.0,
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED, "create {class} failed");
        let body = body_json(resp).await;
        assert_eq!(body["product_class"], class);
        assert_eq!(body["has_expiry"], has_expiry);

        let id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
        f.product_ids.push(id);

        // GET round-trip — class + has_expiry must persist and be exposed.
        let app = app_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri(format!("/products/{id}"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = body_json(resp).await;
        assert_eq!(body["product_class"], class);
        assert_eq!(body["has_expiry"], has_expiry);
        // Additive-only check: pre-existing fields must still be present.
        assert!(body.get("sku").is_some());
        assert!(body.get("unit_of_measure").is_some());
        assert!(body.get("min_stock").is_some());
    }

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_3_create_tool_spare_with_expiry_is_422() {
    let state = state_or_skip!();
    let f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let app = app_router(state.clone());
    let sku = format!("E2E-BADTS-{}", &Uuid::new_v4().to_string()[..6]);
    let req = Request::builder()
        .method("POST")
        .uri("/products")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "name": "bad-tool",
                "sku": sku,
                "unit_of_measure": "piece",
                "product_class": "tool_spare",
                "has_expiry": true,
                "min_stock": 0.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Project convention: Validation → 422.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // No row was persisted.
    let cnt: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products WHERE sku = $1")
        .bind(&sku)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(cnt.0, 0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_3_create_without_class_is_rejected() {
    let state = state_or_skip!();
    let f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/products")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            // No product_class field at all.
            json!({
                "name": "no-class",
                "sku": format!("E2E-NOCL-{}", &Uuid::new_v4().to_string()[..6]),
                "unit_of_measure": "piece",
                "min_stock": 0.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Axum serde rejects the missing required field as 422.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}

// ─── 6.4 — POST /lots/receive matrix ─────────────────────────────────

/// Helper: call POST /lots/receive for `pid` and return (status, body).
async fn call_receive(
    state: &AppState,
    token: &str,
    pid: Uuid,
    wid: Uuid,
    qty: f64,
    expiration_date: Option<&str>,
) -> (StatusCode, Value) {
    let lot_number = format!("LOT-{}", Uuid::new_v4());
    let mut payload = json!({
        "product_id": pid,
        "lot_number": lot_number,
        "warehouse_id": wid,
        "good_quantity": qty,
    });
    if let Some(exp) = expiration_date {
        payload["expiration_date"] = json!(exp);
    }
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/lots/receive")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = body_json(resp).await;
    (status, body)
}

#[tokio::test]
async fn test_6_4_receive_matrix_raw_material_returns_lot() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-RM-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = call_receive(&state, &token, pid, wid, 10.0, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "lot");
    assert!(body["lot"]["id"].as_str().is_some(), "lot.id must be present");

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_4_receive_matrix_consumable_with_expiry_returns_lot() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-CE-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "consumable", true)
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = call_receive(&state, &token, pid, wid, 3.0, Some("2026-12-31")).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "lot");

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_4_receive_matrix_consumable_no_expiry_returns_direct_inventory() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-CN-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "consumable", false)
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = call_receive(&state, &token, pid, wid, 6.0, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "direct_inventory");
    assert!(body["inventory_id"].as_str().is_some());
    assert!(body["movement_id"].as_str().is_some());
    assert_eq!(body["product_id"].as_str().unwrap().parse::<Uuid>().unwrap(), pid);
    assert_eq!(body["quantity"].as_f64().unwrap(), 6.0);

    // No product_lots row created.
    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_4_receive_matrix_tool_spare_returns_direct_inventory() {
    // Verdict: the spec's Inventory & Movements section (authoritative) says
    // tool_spare receives MUST land at Recepción as direct inventory. The
    // Lots section scenario "Receive lot for tool_spare via POST /lots/receive
    // fails" is interpreted as applying to the internal `create_lot` code
    // path (covered by test_create_lot_rejects_tool_spare in the infra suite)
    // — otherwise the two sections contradict each other, and the current
    // implementation (Batch 2/3 design) committed to the permissive path.
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-TS-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "tool_spare", false)
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = call_receive(&state, &token, pid, wid, 2.0, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "direct_inventory");
    assert!(body["inventory_id"].as_str().is_some());
    assert!(body["movement_id"].as_str().is_some());

    // No lot created for tool_spare.
    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    f.cleanup().await;
}

// ─── 6.5 — PO receive-line matrix ────────────────────────────────────

/// Creates a PO in `sent` state with a single line referencing `product_id`.
async fn create_sent_po_with_line(
    pool: &PgPool,
    f: &mut Fixture,
    product_id: Uuid,
    quantity: f64,
) -> (Uuid, Uuid) {
    let supplier_id = f.create_supplier().await;

    // Phase B B6: purchase_orders + purchase_order_lines carry NOT NULL tenant_id.
    let po_row: (Uuid,) = sqlx::query_as(
        "INSERT INTO purchase_orders (tenant_id, supplier_id, order_number, status, created_by) \
         VALUES ($1, $2, $3, 'sent', (SELECT id FROM users WHERE is_superadmin = true LIMIT 1)) \
         RETURNING id",
    )
    .bind(f.tenant_id)
    .bind(supplier_id)
    .bind(format!("PO-TEST-{}", Uuid::new_v4()))
    .fetch_one(pool)
    .await
    .expect("po insert");
    f.po_ids.push(po_row.0);

    let line_row: (Uuid,) = sqlx::query_as(
        "INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, unit_price) \
         VALUES ($1, $2, $3, $4, 1.0) \
         RETURNING id",
    )
    .bind(f.tenant_id)
    .bind(po_row.0)
    .bind(product_id)
    .bind(quantity)
    .fetch_one(pool)
    .await
    .expect("po line insert");

    (po_row.0, line_row.0)
}

async fn po_receive_call(
    state: &AppState,
    token: &str,
    pid: Uuid,
    wid: Uuid,
    qty: f64,
    po_id: Uuid,
    line_id: Uuid,
    expiration_date: Option<&str>,
) -> (StatusCode, Value) {
    let mut payload = json!({
        "product_id": pid,
        "lot_number": format!("POLOT-{}", Uuid::new_v4()),
        "warehouse_id": wid,
        "good_quantity": qty,
        "purchase_order_id": po_id,
        "purchase_order_line_id": line_id,
    });
    if let Some(exp) = expiration_date {
        payload["expiration_date"] = json!(exp);
    }
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/lots/receive")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = body_json(resp).await;
    (status, body)
}

#[tokio::test]
async fn test_6_5_po_receive_raw_material_is_lot_kind() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-PORM-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;
    let (po_id, line_id) = create_sent_po_with_line(&state.pool, &mut f, pid, 5.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = po_receive_call(&state, &token, pid, wid, 5.0, po_id, line_id, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "lot");

    // PO line quantity_received advanced.
    let qr: (f64,) = sqlx::query_as(
        "SELECT quantity_received::float8 FROM purchase_order_lines WHERE id = $1",
    )
    .bind(line_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(qr.0, 5.0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_5_po_receive_consumable_no_expiry_is_direct_inventory() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-POCN-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "consumable", false)
        .await;
    let (po_id, line_id) = create_sent_po_with_line(&state.pool, &mut f, pid, 4.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = po_receive_call(&state, &token, pid, wid, 4.0, po_id, line_id, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "direct_inventory");

    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    // PO line quantity_received still advanced (direct-inventory path must
    // keep PO flow working).
    let qr: (f64,) = sqlx::query_as(
        "SELECT quantity_received::float8 FROM purchase_order_lines WHERE id = $1",
    )
    .bind(line_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(qr.0, 4.0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_5_po_receive_tool_spare_is_direct_inventory() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-POTS-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "tool_spare", false)
        .await;
    let (po_id, line_id) = create_sent_po_with_line(&state.pool, &mut f, pid, 1.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, body) = po_receive_call(&state, &token, pid, wid, 1.0, po_id, line_id, None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["kind"], "direct_inventory");

    f.cleanup().await;
}

// ─── 6.6 — PATCH /products/{id}/class ────────────────────────────────

#[tokio::test]
async fn test_6_6_reclassify_succeeds_on_fresh_product() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({ "product_class": "consumable" }).to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["product_class"], "consumable");

    let cls: (String,) = sqlx::query_as("SELECT product_class::text FROM products WHERE id = $1")
        .bind(pid)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(cls.0, "consumable");

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_6_reclassify_blocked_by_movement_is_409_with_counts() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-RCLMV-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;
    // Receive → creates movement + lot.
    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (status, _) = call_receive(&state, &token, pid, wid, 1.0, None).await;
    assert_eq!(status, StatusCode::CREATED);

    // Reclassify attempt.
    let token2 = mint_token(&state, admin, "superadmin", vec![]).await;
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::from(
            json!({ "product_class": "consumable" }).to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "PRODUCT_CLASS_LOCKED");
    assert!(body["blocked_by"]["movements"].as_i64().unwrap() >= 1);
    // raw_material receive also creates a lot, so lots >= 1 too.
    assert!(body["blocked_by"]["lots"].as_i64().unwrap() >= 1);

    // class unchanged.
    let cls: (String,) = sqlx::query_as("SELECT product_class::text FROM products WHERE id = $1")
        .bind(pid)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(cls.0, "raw_material");

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_6_reclassify_blocked_by_tool_instance_is_409() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "tool_spare", false)
        .await;
    // Insert a tool_instance directly — exercises the tool_instance blocker.
    // B8: tool_instances now carries NOT NULL tenant_id.
    sqlx::query(
        "INSERT INTO tool_instances (tenant_id, product_id, serial) VALUES ($1, $2, $3)",
    )
        .bind(f.tenant_id)
        .bind(pid)
        .bind(format!("SN-{}", Uuid::new_v4()))
        .execute(&state.pool)
        .await
        .unwrap();

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({ "product_class": "raw_material" }).to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "PRODUCT_CLASS_LOCKED");
    assert!(body["blocked_by"]["tool_instances"].as_i64().unwrap() >= 1);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_6_reclassify_to_tool_spare_with_expiry_is_422() {
    // Class/expiry invariant: reclassifying a has_expiry=true product to
    // tool_spare must be rejected.
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "consumable", true)
        .await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({ "product_class": "tool_spare" }).to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let cls: (String,) = sqlx::query_as("SELECT product_class::text FROM products WHERE id = $1")
        .bind(pid)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(cls.0, "consumable");

    f.cleanup().await;
}

// ─── 6.7 — list filter by class ──────────────────────────────────────

#[tokio::test]
async fn test_6_7_list_filter_by_class_returns_only_matching() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let raw_pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;
    let cons_pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "consumable", false)
        .await;
    let tool_pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "tool_spare", false)
        .await;

    // Pull a large page so the three new products are included (the list is
    // paginated; we use per_page=500 which comfortably covers seed + test).
    async fn list(state: &AppState, token: &str, extra_query: &str) -> Value {
        let app = app_router(state.clone());
        let uri = format!("/products?per_page=500{extra_query}");
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        body_json(resp).await
    }

    let all = list(&state, &token, "").await;
    let all_items = all["data"].as_array().unwrap();
    let found: Vec<Uuid> = all_items
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(found.contains(&raw_pid));
    assert!(found.contains(&cons_pid));
    assert!(found.contains(&tool_pid));

    let cons_list = list(&state, &token, "&class=consumable").await;
    let cons_items = cons_list["data"].as_array().unwrap();
    // Every returned item must be consumable.
    for item in cons_items {
        assert_eq!(item["product_class"], "consumable");
    }
    let cons_found: Vec<Uuid> = cons_items
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(cons_found.contains(&cons_pid));
    assert!(!cons_found.contains(&raw_pid));
    assert!(!cons_found.contains(&tool_pid));

    let tool_list = list(&state, &token, "&class=tool_spare").await;
    for item in tool_list["data"].as_array().unwrap() {
        assert_eq!(item["product_class"], "tool_spare");
    }

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_7_list_filter_with_invalid_class_is_422() {
    let state = state_or_skip!();
    let f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri("/products?class=widget")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Query-string parse failures surface as 400 or 422 in axum depending on
    // version. Accept either as a validation rejection.
    let st = resp.status();
    assert!(
        st == StatusCode::UNPROCESSABLE_ENTITY || st == StatusCode::BAD_REQUEST,
        "expected 4xx for invalid class filter, got {st}"
    );

    f.cleanup().await;
}

// ─── 6.8 — GET /products/{id}/class-lock ─────────────────────────────

#[tokio::test]
async fn test_6_8_class_lock_fresh_product_is_unlocked() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri(format!("/products/{pid}/class-lock"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["locked"], false);
    assert_eq!(body["movements"], 0);
    assert_eq!(body["lots"], 0);
    assert_eq!(body["tool_instances"], 0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_8_class_lock_after_receive_is_locked() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-LCK-{}", Uuid::new_v4()))
        .await;
    let pid = f
        .create_product(&Uuid::new_v4().to_string()[..8], "raw_material", false)
        .await;
    let token = mint_token(&state, admin, "superadmin", vec![wid]).await;
    let (st, _) = call_receive(&state, &token, pid, wid, 1.0, None).await;
    assert_eq!(st, StatusCode::CREATED);

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri(format!("/products/{pid}/class-lock"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["locked"], true);
    assert!(body["movements"].as_i64().unwrap() >= 1);
    assert!(body["lots"].as_i64().unwrap() >= 1);

    f.cleanup().await;
}

// ─── 6.12 tail — /tool-instances is NOT a registered route ──────────

#[tokio::test]
async fn test_6_12_tool_instances_route_is_not_registered() {
    let state = state_or_skip!();
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]).await;

    for method in ["GET", "POST"] {
        let app = app_router(state.clone());
        let req = Request::builder()
            .method(method)
            .uri("/tool-instances")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        // Route MUST NOT be registered — expect 404 Not Found (no handler)
        // or 405 Method Not Allowed if axum collapses unknown methods.
        let st = resp.status();
        assert!(
            st == StatusCode::NOT_FOUND || st == StatusCode::METHOD_NOT_ALLOWED,
            "expected 404/405 for /tool-instances (got {st})"
        );
    }
}
