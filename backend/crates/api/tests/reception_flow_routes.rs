// HTTP integration tests for the receiving-location-flow change.
//
// Mounts the production router against a real Postgres DB via
// `DATABASE_URL` (falls back to the project `.env`). Tests that need the DB
// skip cleanly when one isn't available.
//
// Auth is exercised by minting JWT tokens against a fixed-secret `JwtConfig`
// set per-process. Each test creates its own warehouse/product/user fixtures
// and tears them down on exit.

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

// ─── Test harness ────────────────────────────────────────────────────

const TEST_JWT_SECRET: &str = "test-secret-for-integration-only";

async fn maybe_state() -> Option<AppState> {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();

    let database_url = env::var("DATABASE_URL").ok()?;
    let redis_url =
        env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6381".to_string());

    let pool = PgPool::connect(&database_url).await.ok()?;
    let redis = vandepot_infra::redis::create_redis_pool(&redis_url)
        .await
        .ok()?;

    let jwt_config = JwtConfig {
        secret: TEST_JWT_SECRET.to_string(),
        access_expiration: 900,
        refresh_expiration: 604_800,
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

fn mint_token(state: &AppState, user_id: Uuid, role: &str, warehouse_ids: Vec<Uuid>) -> String {
    create_access_token(
        &state.jwt_config,
        user_id,
        &format!("{role}@test.dev"),
        role,
        warehouse_ids,
    )
    .expect("token mint")
}

/// Fetch the seeded superadmin user id (bootstrapped by `seed_superadmin`).
async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as(
        "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .expect("superadmin seed must exist");
    row.0
}

/// Insert a throwaway user with the given role and return its id.
async fn create_user(pool: &PgPool, role: &str) -> Uuid {
    let email = format!("test-{}-{}@vandev.mx", role, Uuid::new_v4());
    let row: (Uuid,) = sqlx::query_as(
        "INSERT INTO users (email, password_hash, name, role) \
         VALUES ($1, 'x', 'Test User', $2::user_role) \
         RETURNING id",
    )
    .bind(&email)
    .bind(role)
    .fetch_one(pool)
    .await
    .expect("user insert");
    row.0
}

struct Fixture {
    state: AppState,
    warehouse_ids: Vec<Uuid>,
    product_ids: Vec<Uuid>,
    user_ids: Vec<Uuid>,
}

impl Fixture {
    async fn new(state: AppState) -> Self {
        Self {
            state,
            warehouse_ids: Vec::new(),
            product_ids: Vec::new(),
            user_ids: Vec::new(),
        }
    }

    async fn create_warehouse_direct(&mut self, name: &str) -> Uuid {
        // Use the repo directly so we don't go through the HTTP layer
        // (which wants an auth token this helper would re-mint).
        use vandepot_domain::ports::warehouse_repository::WarehouseRepository;
        use vandepot_infra::repositories::warehouse_repo::PgWarehouseRepository;
        let repo = PgWarehouseRepository::new(self.state.pool.clone());
        let wh = repo.create(name, None).await.expect("warehouse create");
        self.warehouse_ids.push(wh.id);
        wh.id
    }

    async fn create_product(&mut self, suffix: &str) -> Uuid {
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO products (name, sku, unit_of_measure) \
             VALUES ($1, $2, 'piece') \
             RETURNING id",
        )
        .bind(format!("Prod {suffix}"))
        .bind(format!("TST-R-{suffix}"))
        .fetch_one(&self.state.pool)
        .await
        .expect("product insert");
        self.product_ids.push(row.0);
        row.0
    }

    async fn create_zone(&self, warehouse_id: Uuid, name: &str) -> Uuid {
        use vandepot_domain::models::enums::LocationType;
        use vandepot_domain::ports::location_repository::LocationRepository;
        use vandepot_infra::repositories::location_repo::PgLocationRepository;
        let repo = PgLocationRepository::new(self.state.pool.clone());
        let loc = repo
            .create(warehouse_id, None, LocationType::Zone, name, None)
            .await
            .expect("zone create");
        loc.id
    }

    async fn reception_id(&self, warehouse_id: Uuid) -> Uuid {
        use vandepot_domain::ports::location_repository::LocationRepository;
        use vandepot_infra::repositories::location_repo::PgLocationRepository;
        let repo = PgLocationRepository::new(self.state.pool.clone());
        repo.find_reception_by_warehouse(warehouse_id)
            .await
            .expect("find_reception")
            .expect("reception exists")
            .id
    }

    async fn track_user(&mut self, role: &str) -> Uuid {
        let id = create_user(&self.state.pool, role).await;
        self.user_ids.push(id);
        id
    }

    async fn cleanup(&self) {
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
            let _ = sqlx::query("DELETE FROM product_lots WHERE product_id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM products WHERE id = $1")
                .bind(pid)
                .execute(&self.state.pool)
                .await;
        }
        for uid in &self.user_ids {
            let _ = sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(uid)
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

// ─── Phase 5.6 — warehouses / locations ──────────────────────────────

#[tokio::test]
async fn test_create_warehouse_creates_reception() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]);

    let app = app_router(state.clone());
    let name = format!("WH-HTTP-{}", Uuid::new_v4());
    let req = Request::builder()
        .method("POST")
        .uri("/warehouses")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(json!({ "name": name }).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = body_json(resp).await;
    let wid: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    f.warehouse_ids.push(wid);

    // Reception must exist.
    let cnt: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations \
         WHERE warehouse_id = $1 AND location_type = 'reception'",
    )
    .bind(wid)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(cnt.0, 1);

    f.cleanup().await;
}

#[tokio::test]
async fn test_delete_reception_returns_409_with_code() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]);

    let wid = f.create_warehouse_direct(&format!("WH-HTTP-DEL-{}", Uuid::new_v4())).await;
    let rcp = f.reception_id(wid).await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/locations/{rcp}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body = body_json(resp).await;
    assert_eq!(body["code"], "SYSTEM_LOCATION_PROTECTED");
    assert!(body.get("error").is_some());

    f.cleanup().await;
}

#[tokio::test]
async fn test_create_reception_location_manually_rejected() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]);

    let wid = f
        .create_warehouse_direct(&format!("WH-HTTP-CREJ-{}", Uuid::new_v4()))
        .await;

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/warehouses/{wid}/locations"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "name": "Hack",
                "location_type": "reception"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Validation errors bubble as 422 in this codebase.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}

// ─── Phase 5.7 — /lots/receive and /lots/{id}/distribute ────────────

#[tokio::test]
async fn test_lots_receive_with_warehouse_id_lands_at_reception() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-RCV-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = f.reception_id(wid).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]);
    let lot_number = format!("LOT-{}", Uuid::new_v4());
    let payload = json!({
        "product_id": pid,
        "lot_number": lot_number,
        "warehouse_id": wid,
        "good_quantity": 42.0,
    });

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/lots/receive")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Movement went to Reception.
    let mv: (Option<Uuid>, String) = sqlx::query_as(
        "SELECT to_location_id, movement_reason FROM movements \
         WHERE product_id = $1 AND movement_reason = 'purchase_receive' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(pid)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(mv.0, Some(rcp));

    f.cleanup().await;
}

#[tokio::test]
async fn test_lots_receive_legacy_location_id_is_422() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-LEG-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = f.reception_id(wid).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]);
    let payload = json!({
        "product_id": pid,
        "lot_number": format!("LOT-{}", Uuid::new_v4()),
        "location_id": rcp,   // legacy field — must be rejected
        "good_quantity": 10.0,
    });

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/lots/receive")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Axum surfaces serde deserialization errors as 422.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_happy_path_via_http() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-DISTH-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = f.create_zone(wid, "Zona").await;

    // Receive first.
    let lot = vandepot_infra::repositories::lots_repo::receive_lot(
        &state.pool,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        25.0,
        0.0,
        None,
        None,
        None,
        admin,
        None,
        None,
        None,
    )
    .await
    .unwrap();

    let token = mint_token(&state, admin, "superadmin", vec![wid]);

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/lots/{}/distribute", lot.id))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({ "to_location_id": zone, "quantity": 25.0 }).to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = body_json(resp).await;
    assert!(body.is_array(), "distribute response must be an array of inventory rows");

    f.cleanup().await;
}

#[tokio::test]
async fn test_transfer_lot_rejects_reception_via_http() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-TRFH-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = f.create_zone(wid, "Zona").await;
    let rcp = f.reception_id(wid).await;

    let lot = vandepot_infra::repositories::lots_repo::receive_lot(
        &state.pool,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        10.0,
        0.0,
        None,
        None,
        None,
        admin,
        None,
        None,
        None,
    )
    .await
    .unwrap();

    let token = mint_token(&state, admin, "superadmin", vec![wid]);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/lots/{}/transfer", lot.id))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "from_location_id": rcp,
                "to_location_id": zone,
                "quantity": 5.0
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Domain Validation → HTTP 422 in this codebase.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}

// ─── Phase 5.8 — /inventory/opening-balance ─────────────────────────

#[tokio::test]
async fn test_opening_balance_as_superadmin_is_201() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-OBH-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = f.create_zone(wid, "Zona").await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/inventory/opening-balance")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "product_id": pid,
                "warehouse_id": wid,
                "location_id": zone,
                "quantity": 100.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Verify movement reason stamped correctly.
    let mv: (String,) = sqlx::query_as(
        "SELECT movement_reason FROM movements \
         WHERE product_id = $1 AND movement_reason = 'initial_load' LIMIT 1",
    )
    .bind(pid)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(mv.0, "initial_load");

    f.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_as_warehouse_manager_is_403() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-OB403-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = f.create_zone(wid, "Zona").await;
    let manager = f.track_user("warehouse_manager").await;

    let token = mint_token(&state, manager, "warehouse_manager", vec![wid]);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/inventory/opening-balance")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "product_id": pid,
                "warehouse_id": wid,
                "location_id": zone,
                "quantity": 10.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    f.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_rejects_reception_target_via_http() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid = f
        .create_warehouse_direct(&format!("WH-OBR-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = f.reception_id(wid).await;

    let token = mint_token(&state, admin, "superadmin", vec![wid]);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/inventory/opening-balance")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "product_id": pid,
                "warehouse_id": wid,
                "location_id": rcp,
                "quantity": 10.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Validation → 422.
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_rejects_wrong_warehouse_via_http() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let wid_a = f
        .create_warehouse_direct(&format!("WH-OBWA-{}", Uuid::new_v4()))
        .await;
    let wid_b = f
        .create_warehouse_direct(&format!("WH-OBWB-{}", Uuid::new_v4()))
        .await;
    let pid = f.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone_b = f.create_zone(wid_b, "Zona B").await;

    let token = mint_token(&state, admin, "superadmin", vec![wid_a, wid_b]);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/inventory/opening-balance")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "product_id": pid,
                "warehouse_id": wid_a,
                "location_id": zone_b,
                "quantity": 10.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    f.cleanup().await;
}
