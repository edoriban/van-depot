// HTTP integration tests for the Work Orders + BOM change.
//
// Phase 6 task coverage (see engram #378 + #379):
//   6.3  — POST /work-orders happy path (code format, material snapshot).
//   6.4  — POST /work-orders + POST /products FG invariants (422 with code).
//   6.5  — create WO rejects recipe containing tool_spare (422 w/ offenders).
//   6.6  — create WO rejects warehouse with 0 work_centers.
//   6.7  — POST /work-orders/{id}/issue happy path (movements, status flip).
//   6.8  — issue rejected from non-draft states (409 INVALID_TRANSITION).
//   6.9  — POST /work-orders/{id}/complete happy path with 3 materials +
//          FEFO + FG lot + production_output entry.
//   6.10 — complete rejected 409 INSUFFICIENT_WORK_ORDER_STOCK — snapshot
//          row counts BEFORE/AFTER and assert literal equality.
//   6.11 — complete honors fg_expiration_date only when has_expiry=true.
//   6.12 — cancel from draft (no movements reversed).
//   6.13 — cancel from in_progress — reverses all wo_issue transfers; net
//          inventory change = 0 over the visited (product, location) map.
//   6.14 — GET /work-orders filters by status / warehouse / work_center.
//   6.15 — GET /movements?work_order_id=... returns every tied movement.
//   6.16 — PATCH /products/{id}/class rejected while is_manufactured=true.
//
// Harness mirrors `product_classification.rs` and `reception_flow_routes.rs`:
// tests skip cleanly when DATABASE_URL is unavailable, create their own
// warehouse/product/recipe fixtures, and tear down on exit.
//
// Pre-existing seed (WO-DEMO-01 + WO-DEMO-02) is ignored by every test via
// per-test-scoped warehouses + products. WO-DEMO movements/lots remain intact.

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use chrono::NaiveDate;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::HashMap;
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

use vandepot_api::{app_router, state::AppState};
use vandepot_infra::auth::jwt::{create_access_token, JwtConfig};

// ─── Harness ─────────────────────────────────────────────────────────

const TEST_JWT_SECRET: &str = "test-secret-for-integration-only";

async fn maybe_state() -> Option<AppState> {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();

    let database_url = env::var("DATABASE_URL").ok()?;
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6381".to_string());

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

async fn superadmin_id(pool: &PgPool) -> Uuid {
    let row: (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("superadmin seed must exist");
    row.0
}

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

// ─── Fixture ─────────────────────────────────────────────────────────

struct Fixture {
    state: AppState,
    warehouse_ids: Vec<Uuid>,
    product_ids: Vec<Uuid>,
    recipe_ids: Vec<Uuid>,
    wo_ids: Vec<Uuid>,
    suffix: String,
}

impl Fixture {
    async fn new(state: AppState) -> Self {
        Self {
            state,
            warehouse_ids: Vec::new(),
            product_ids: Vec::new(),
            recipe_ids: Vec::new(),
            wo_ids: Vec::new(),
            suffix: Uuid::new_v4().to_string()[..8].to_string(),
        }
    }

    /// Create a warehouse via the repo (auto-backfills Recepción + finished_good).
    async fn create_warehouse(&mut self, name: &str) -> Uuid {
        use vandepot_domain::ports::warehouse_repository::WarehouseRepository;
        use vandepot_infra::repositories::warehouse_repo::PgWarehouseRepository;
        let repo = PgWarehouseRepository::new(self.state.pool.clone());
        let wh = repo.create(name, None).await.expect("warehouse create");
        self.warehouse_ids.push(wh.id);
        wh.id
    }

    /// Create a product via direct SQL.
    async fn create_product(
        &mut self,
        sku_suffix: &str,
        class: &str,
        has_expiry: bool,
        is_manufactured: bool,
    ) -> Uuid {
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO products \
                (name, sku, unit_of_measure, product_class, has_expiry, is_manufactured) \
             VALUES ($1, $2, 'piece', $3::product_class, $4, $5) \
             RETURNING id",
        )
        .bind(format!("WO-Prod {sku_suffix}"))
        .bind(format!("WOT-{}-{sku_suffix}", self.suffix))
        .bind(class)
        .bind(has_expiry)
        .bind(is_manufactured)
        .fetch_one(&self.state.pool)
        .await
        .expect("product insert");
        self.product_ids.push(row.0);
        row.0
    }

    /// Create a work_center location via direct SQL (is_system=true required
    /// by CHECK constraint chk_work_center_is_system).
    async fn create_work_center(&self, warehouse_id: Uuid, name: &str) -> Uuid {
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO locations \
                (warehouse_id, location_type, name, is_system, pos_x, pos_y, width, height) \
             VALUES ($1, 'work_center', $2, true, 100, 100, 80, 80) \
             RETURNING id",
        )
        .bind(warehouse_id)
        .bind(name)
        .fetch_one(&self.state.pool)
        .await
        .expect("work_center insert");
        row.0
    }

    /// Create a storage zone (regular location) via direct SQL. Not is_system.
    async fn create_zone(&self, warehouse_id: Uuid, name: &str) -> Uuid {
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO locations \
                (warehouse_id, location_type, name, is_system, pos_x, pos_y, width, height) \
             VALUES ($1, 'zone', $2, false, 0, 0, 50, 50) \
             RETURNING id",
        )
        .bind(warehouse_id)
        .bind(name)
        .fetch_one(&self.state.pool)
        .await
        .expect("zone insert");
        row.0
    }

    #[allow(dead_code)]
    async fn finished_good_location(&self, warehouse_id: Uuid) -> Uuid {
        let row: (Uuid,) = sqlx::query_as(
            "SELECT id FROM locations \
             WHERE warehouse_id = $1 AND location_type = 'finished_good' AND is_system = true \
             LIMIT 1",
        )
        .bind(warehouse_id)
        .fetch_one(&self.state.pool)
        .await
        .expect("finished_good backfilled");
        row.0
    }

    /// Create a recipe via direct SQL with the given ingredients (no guards —
    /// allows tool_spare for 6.5).
    async fn create_recipe_direct(
        &mut self,
        name: &str,
        creator: Uuid,
        items: &[(Uuid, f64)],
    ) -> Uuid {
        let rid: (Uuid,) = sqlx::query_as(
            "INSERT INTO recipes (name, created_by) VALUES ($1, $2) RETURNING id",
        )
        .bind(name)
        .bind(creator)
        .fetch_one(&self.state.pool)
        .await
        .expect("recipe insert");
        for (product_id, qty) in items {
            sqlx::query(
                "INSERT INTO recipe_items (recipe_id, product_id, quantity) VALUES ($1, $2, $3)",
            )
            .bind(rid.0)
            .bind(product_id)
            .bind(qty)
            .execute(&self.state.pool)
            .await
            .expect("recipe_item insert");
        }
        self.recipe_ids.push(rid.0);
        rid.0
    }

    /// Seed direct (non-lot) inventory at a location.
    async fn seed_inventory(&self, product_id: Uuid, location_id: Uuid, qty: f64) {
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(product_id)
        .bind(location_id)
        .bind(qty)
        .execute(&self.state.pool)
        .await
        .expect("inventory upsert");
    }

    /// Seed a lot-backed inventory row (product_lots + inventory_lots + inventory).
    async fn seed_lot(
        &self,
        product_id: Uuid,
        location_id: Uuid,
        lot_number: &str,
        qty: f64,
        expiration_date: Option<NaiveDate>,
    ) -> Uuid {
        let pl: (Uuid,) = sqlx::query_as(
            "INSERT INTO product_lots \
                (product_id, lot_number, expiration_date, received_quantity, quality_status) \
             VALUES ($1, $2, $3, $4, 'approved') \
             RETURNING id",
        )
        .bind(product_id)
        .bind(lot_number)
        .bind(expiration_date)
        .bind(qty)
        .fetch_one(&self.state.pool)
        .await
        .expect("product_lot insert");
        sqlx::query(
            "INSERT INTO inventory_lots (product_lot_id, location_id, quantity) \
             VALUES ($1, $2, $3)",
        )
        .bind(pl.0)
        .bind(location_id)
        .bind(qty)
        .execute(&self.state.pool)
        .await
        .expect("inventory_lots insert");
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(product_id)
        .bind(location_id)
        .bind(qty)
        .execute(&self.state.pool)
        .await
        .expect("inventory upsert (lot-backed)");
        pl.0
    }

    async fn cleanup(&self) {
        // WOs first (cascades to work_order_materials, nulls movements.work_order_id).
        for wo_id in &self.wo_ids {
            let _ = sqlx::query("DELETE FROM movements WHERE work_order_id = $1")
                .bind(wo_id)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM work_orders WHERE id = $1")
                .bind(wo_id)
                .execute(&self.state.pool)
                .await;
        }
        for rid in &self.recipe_ids {
            let _ = sqlx::query("DELETE FROM recipe_items WHERE recipe_id = $1")
                .bind(rid)
                .execute(&self.state.pool)
                .await;
            let _ = sqlx::query("DELETE FROM recipes WHERE id = $1")
                .bind(rid)
                .execute(&self.state.pool)
                .await;
        }
        // Delete warehouses — cascades to locations, inventory, inventory_lots, product_lots
        // are NOT cascaded through warehouses but we delete them via product_ids below.
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
    }
}

/// Convenience POST /work-orders caller returning (status, body).
async fn post_work_order(
    state: &AppState,
    token: &str,
    payload: Value,
) -> (StatusCode, Value) {
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/work-orders")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    (resp.status(), body_json(resp).await)
}

async fn post_action(
    state: &AppState,
    token: &str,
    wo_id: Uuid,
    action: &str,
    payload: Value,
) -> (StatusCode, Value) {
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/work-orders/{wo_id}/{action}"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(payload.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    (resp.status(), body_json(resp).await)
}

/// Snapshot row counts used to prove zero-side-effect behaviour (6.10).
#[derive(Debug, PartialEq, Eq)]
struct RowCounts {
    movements: i64,
    product_lots: i64,
    inventory: i64,
    inventory_lots: i64,
    wo_materials_consumed_zero: i64,
}

async fn snapshot_counts(pool: &PgPool, wo_id: Uuid) -> RowCounts {
    let movements: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
        .bind(wo_id)
        .fetch_one(pool)
        .await
        .unwrap();
    // Count lots whose lot_number matches the WO's code (FG lot format
    // WO-<code>-<YYYYMMDD>).
    let wo_code: (String,) = sqlx::query_as("SELECT code FROM work_orders WHERE id = $1")
        .bind(wo_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let pattern = format!("WO-{}-%", wo_code.0);
    let product_lots: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE lot_number LIKE $1")
            .bind(&pattern)
            .fetch_one(pool)
            .await
            .unwrap();
    // Scoped counts against the WO's warehouse to avoid cross-test contamination.
    let inventory: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM inventory i \
         JOIN locations l ON l.id = i.location_id \
         WHERE l.warehouse_id = (SELECT warehouse_id FROM work_orders WHERE id = $1)",
    )
    .bind(wo_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let inventory_lots: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM inventory_lots il \
         JOIN locations l ON l.id = il.location_id \
         WHERE l.warehouse_id = (SELECT warehouse_id FROM work_orders WHERE id = $1)",
    )
    .bind(wo_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let wom: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM work_order_materials \
         WHERE work_order_id = $1 AND quantity_consumed = 0",
    )
    .bind(wo_id)
    .fetch_one(pool)
    .await
    .unwrap();

    RowCounts {
        movements: movements.0,
        product_lots: product_lots.0,
        inventory: inventory.0,
        inventory_lots: inventory_lots.0,
        wo_materials_consumed_zero: wom.0,
    }
}

// ─── 6.3 — POST /work-orders happy path ──────────────────────────────

#[tokio::test]
async fn test_6_3_create_work_order_happy_path() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let warehouse = f
        .create_warehouse(&format!("WO-6.3-{}", f.suffix.clone()))
        .await;
    let wc = f.create_work_center(warehouse, &format!("WC-6.3-{}", f.suffix)).await;
    let fg = f
        .create_product("fg-63", "raw_material", false, true)
        .await;
    let m1 = f
        .create_product("m1-63", "raw_material", false, false)
        .await;
    let m2 = f
        .create_product("m2-63", "consumable", false, false)
        .await;
    let recipe = f
        .create_recipe_direct(
            &format!("Recipe-6.3-{}", f.suffix),
            admin,
            &[(m1, 2.0), (m2, 3.0)],
        )
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_work_order(
        &state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": wc,
            "notes": "test 6.3"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "body={body}");
    let wo_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    f.wo_ids.push(wo_id);

    assert_eq!(body["status"], "draft");
    let code = body["code"].as_str().unwrap().to_string();
    // Regex equivalent: WO-YYYYMMDD-<6 upper hex>
    assert!(
        code.starts_with("WO-") && code.len() == 3 + 8 + 1 + 6,
        "unexpected code format: {code}"
    );
    let prefix_rest = &code[3..];
    let (date_part, rest) = prefix_rest.split_at(8);
    assert!(date_part.chars().all(|c| c.is_ascii_digit()), "date: {date_part}");
    assert!(rest.starts_with('-'), "separator: {rest}");
    let hex = &rest[1..];
    assert!(
        hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_lowercase()),
        "hex uppercase: {hex}"
    );

    let materials = body["materials"].as_array().expect("materials list");
    assert_eq!(materials.len(), 2, "expected 2 materials");
    for m in materials {
        assert_eq!(m["quantity_consumed"].as_f64().unwrap(), 0.0);
        let expected = m["quantity_expected"].as_f64().unwrap();
        assert!(expected == 2.0 || expected == 3.0, "unknown qty {expected}");
    }

    // DB assertions.
    let wo_cnt: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM work_orders WHERE id = $1")
        .bind(wo_id)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(wo_cnt.0, 1);
    let wom_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(wom_cnt.0, 2);

    f.cleanup().await;
}

// ─── 6.4 — FG invariants ─────────────────────────────────────────────

#[tokio::test]
async fn test_6_4a_create_wo_rejects_fg_not_manufactured() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let warehouse = f.create_warehouse(&format!("WO-6.4a-{}", f.suffix.clone())).await;
    let wc = f.create_work_center(warehouse, &format!("WC-6.4a-{}", f.suffix)).await;
    // FG NOT manufactured.
    let fg = f
        .create_product("fg-64a", "raw_material", false, false)
        .await;
    let m1 = f
        .create_product("m-64a", "consumable", false, false)
        .await;
    let recipe = f
        .create_recipe_direct(
            &format!("Recipe-6.4a-{}", f.suffix),
            admin,
            &[(m1, 1.0)],
        )
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_work_order(
        &state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": wc,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "body={body}");
    assert_eq!(body["code"], "WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED");

    // No rows inserted.
    let cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM work_orders WHERE warehouse_id = $1")
            .bind(warehouse)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(cnt.0, 0);

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_4b_create_product_with_is_manufactured_non_raw_material_rejected() {
    let state = state_or_skip!();
    let f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]);

    let sku = format!("WOT-{}-64b", f.suffix);
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/products")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(
            json!({
                "name": "Bad MFG Consumable",
                "sku": sku,
                "unit_of_measure": "piece",
                "product_class": "consumable",
                "has_expiry": false,
                "is_manufactured": true,
                "min_stock": 0.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL");

    // No product inserted.
    let cnt: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products WHERE sku = $1")
        .bind(&sku)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(cnt.0, 0);

    f.cleanup().await;
}

// ─── 6.5 — recipe with tool_spare ingredient ─────────────────────────

#[tokio::test]
async fn test_6_5_create_wo_rejects_recipe_with_tool_spare() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let warehouse = f.create_warehouse(&format!("WO-6.5-{}", f.suffix.clone())).await;
    let wc = f.create_work_center(warehouse, &format!("WC-6.5-{}", f.suffix)).await;
    let fg = f
        .create_product("fg-65", "raw_material", false, true)
        .await;
    let m_ok = f
        .create_product("m-65-ok", "consumable", false, false)
        .await;
    let m_tool = f
        .create_product("m-65-tool", "tool_spare", false, false)
        .await;
    // Build recipe directly in SQL to bypass the recipe-create guard (tests
    // the WO-creation belt-and-suspenders path).
    let recipe = f
        .create_recipe_direct(
            &format!("Recipe-6.5-{}", f.suffix),
            admin,
            &[(m_ok, 1.0), (m_tool, 2.0)],
        )
        .await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_work_order(
        &state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": wc,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "body={body}");
    assert_eq!(body["code"], "WORK_ORDER_BOM_INCLUDES_TOOL_SPARE");
    let offenders = body["offending_product_ids"].as_array().expect("list");
    assert_eq!(offenders.len(), 1);
    assert_eq!(
        offenders[0].as_str().unwrap().parse::<Uuid>().unwrap(),
        m_tool
    );

    let cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM work_orders WHERE warehouse_id = $1")
            .bind(warehouse)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(cnt.0, 0);

    f.cleanup().await;
}

// ─── 6.6 — warehouse with 0 work_centers ─────────────────────────────

#[tokio::test]
async fn test_6_6_create_wo_rejects_warehouse_without_work_center() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let warehouse = f.create_warehouse(&format!("WO-6.6-{}", f.suffix.clone())).await;
    // Deliberately NO work_center — just one zone for storage.
    let _zone = f.create_zone(warehouse, &format!("ZN-6.6-{}", f.suffix)).await;
    let fg = f
        .create_product("fg-66", "raw_material", false, true)
        .await;
    let m1 = f
        .create_product("m-66", "consumable", false, false)
        .await;
    let recipe = f
        .create_recipe_direct(
            &format!("Recipe-6.6-{}", f.suffix),
            admin,
            &[(m1, 1.0)],
        )
        .await;

    // Provide any location id as work_center_location_id — the guard runs
    // BEFORE the per-location type check.
    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_work_order(
        &state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": warehouse, // any uuid — will short-circuit
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "body={body}");
    assert_eq!(body["code"], "WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER");
    assert_eq!(
        body["warehouse_id"].as_str().unwrap().parse::<Uuid>().unwrap(),
        warehouse
    );

    let cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM work_orders WHERE warehouse_id = $1")
            .bind(warehouse)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(cnt.0, 0);

    f.cleanup().await;
}

// ─── 6.7 — issue happy path ──────────────────────────────────────────

/// Create a fully-provisioned WO in `draft` state with N materials each
/// seeded with `seed_qty_per_material` at a storage zone (for auto-pick).
async fn setup_draft_wo(
    f: &mut Fixture,
    admin: Uuid,
    tag: &str,
    num_materials: usize,
    seed_qty_per_material: f64,
) -> (Uuid, Uuid, Uuid, Uuid, Vec<Uuid>) {
    let warehouse = f.create_warehouse(&format!("WO-{tag}-{}", f.suffix)).await;
    let wc = f.create_work_center(warehouse, &format!("WC-{tag}-{}", f.suffix)).await;
    let storage = f.create_zone(warehouse, &format!("ZN-{tag}-{}", f.suffix)).await;
    let fg = f
        .create_product(&format!("fg-{tag}"), "raw_material", false, true)
        .await;
    let mut material_ids: Vec<Uuid> = Vec::with_capacity(num_materials);
    for i in 0..num_materials {
        let class = if i % 2 == 0 { "raw_material" } else { "consumable" };
        let m = f
            .create_product(&format!("m{i}-{tag}"), class, false, false)
            .await;
        material_ids.push(m);
    }
    let items: Vec<(Uuid, f64)> = material_ids.iter().map(|id| (*id, 2.0)).collect();
    let recipe = f
        .create_recipe_direct(&format!("Recipe-{tag}-{}", f.suffix), admin, &items)
        .await;

    for m in &material_ids {
        f.seed_inventory(*m, storage, seed_qty_per_material).await;
    }

    let token = mint_token(&f.state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_work_order(
        &f.state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": wc,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "fixture WO create body={body}");
    let wo_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    f.wo_ids.push(wo_id);

    (wo_id, warehouse, wc, storage, material_ids)
}

#[tokio::test]
async fn test_6_7_issue_happy_path() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse, wc, _storage, materials) =
        setup_draft_wo(&mut f, admin, "67", 2, 10.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_action(&state, &token, wo_id, "issue", json!({})).await;

    assert_eq!(status, StatusCode::OK, "body={body}");
    assert_eq!(body["status"], "in_progress");
    assert!(body["issued_at"].is_string());

    let mv_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movements \
         WHERE work_order_id = $1 AND movement_reason = 'wo_issue'",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(mv_count.0, materials.len() as i64);

    // Every wo_issue movement lands at the work_center.
    let bad_dest: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movements \
         WHERE work_order_id = $1 AND movement_reason = 'wo_issue' \
           AND to_location_id <> $2",
    )
    .bind(wo_id)
    .bind(wc)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(bad_dest.0, 0);

    f.cleanup().await;
}

// ─── 6.8 — issue from non-draft ──────────────────────────────────────

#[tokio::test]
async fn test_6_8_issue_rejected_from_in_progress() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse, _wc, _storage, _materials) =
        setup_draft_wo(&mut f, admin, "68", 1, 10.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    // Advance to in_progress.
    let (st1, _) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st1, StatusCode::OK);

    let mv_before: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();

    // Re-issue → 409 INVALID_TRANSITION.
    let (status, body) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "body={body}");
    assert_eq!(body["code"], "WORK_ORDER_INVALID_TRANSITION");
    assert_eq!(body["from"], "in_progress");
    assert_eq!(body["to"], "in_progress");

    // Status unchanged; no new movements.
    let status_after: (String,) =
        sqlx::query_as("SELECT status::text FROM work_orders WHERE id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(status_after.0, "in_progress");
    let mv_after: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(mv_after.0, mv_before.0);

    f.cleanup().await;
}

// ─── 6.9 — complete happy path (3 materials + FEFO) ──────────────────

#[tokio::test]
async fn test_6_9_complete_happy_path_with_fefo() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    // 3 materials, quantity_expected=2 each.
    let (wo_id, warehouse, wc, _storage, materials) =
        setup_draft_wo(&mut f, admin, "69", 3, 10.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    // Issue first (moves materials to work-center as direct inventory, since
    // seeding went to storage zone, the transfer creates direct-inventory at
    // the work-center).
    let (st, _) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st, StatusCode::OK);

    // For the FEFO assertion, overlay two lots for materials[0] at the
    // work_center with differing expiration dates. Existing direct inventory
    // at wc is 2.0 (from issue) — but with lots added, the `inventory` row
    // sums lot + direct.
    let early_exp = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
    let later_exp = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
    let early_lot = f
        .seed_lot(
            materials[0],
            wc,
            &format!("FEFO-E-{}", f.suffix),
            1.0,
            Some(early_exp),
        )
        .await;
    let later_lot = f
        .seed_lot(
            materials[0],
            wc,
            &format!("FEFO-L-{}", f.suffix),
            3.0,
            Some(later_exp),
        )
        .await;

    // Now complete the WO. Material[0] needs 2.0, available at wc = 2 direct
    // + 1 (early) + 3 (later) = 6. FEFO picks 1.0 from early (exhausts),
    // then 1.0 from later — leaving later at 2.0, early_lot consumed.
    let (status, body) = post_action(
        &state,
        &token,
        wo_id,
        "complete",
        json!({ "fg_expiration_date": null }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body={body}");
    assert_eq!(body["status"], "completed");
    assert!(body["completed_at"].is_string());

    // Each material has quantity_consumed=quantity_expected.
    let wom: Vec<(f64, f64)> = sqlx::query_as(
        "SELECT quantity_expected::float8, quantity_consumed::float8 \
         FROM work_order_materials WHERE work_order_id = $1",
    )
    .bind(wo_id)
    .fetch_all(&state.pool)
    .await
    .unwrap();
    assert_eq!(wom.len(), 3);
    for (exp, cons) in &wom {
        assert_eq!(exp, cons, "material {exp} != {cons}");
    }

    // 3 back_flush exit + 1 production_output entry.
    let bf: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movements \
         WHERE work_order_id = $1 AND movement_reason = 'back_flush'",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(bf.0, 3);
    let po: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movements \
         WHERE work_order_id = $1 AND movement_reason = 'production_output'",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(po.0, 1);

    // FG lot exists with WO-<code>-... lot_number.
    let fg_lot: (String, String) = sqlx::query_as(
        "SELECT pl.lot_number, pl.quality_status::text FROM product_lots pl \
         WHERE pl.lot_number LIKE 'WO-' || (SELECT code FROM work_orders WHERE id = $1) || '-%' \
         LIMIT 1",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert!(fg_lot.0.starts_with("WO-WO-"));
    assert_eq!(fg_lot.1, "pending");

    // FEFO assertion: early lot consumed (DELETE-on-zero), later lot has 2.0.
    let early_remaining: Option<(f64,)> = sqlx::query_as(
        "SELECT quantity::float8 FROM inventory_lots \
         WHERE product_lot_id = $1 AND location_id = $2",
    )
    .bind(early_lot)
    .bind(wc)
    .fetch_optional(&state.pool)
    .await
    .unwrap();
    assert!(
        early_remaining.is_none() || early_remaining.unwrap().0 == 0.0,
        "early lot should be exhausted under FEFO"
    );
    let later_remaining: (f64,) = sqlx::query_as(
        "SELECT quantity::float8 FROM inventory_lots \
         WHERE product_lot_id = $1 AND location_id = $2",
    )
    .bind(later_lot)
    .bind(wc)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(
        later_remaining.0, 2.0,
        "later lot should have 2.0 remaining (1 taken of 3)"
    );

    f.cleanup().await;
}

// ─── 6.10 — complete insufficient: snapshot invariant ────────────────

#[tokio::test]
async fn test_6_10_complete_insufficient_stock_has_no_side_effects() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    // 3 materials qty_expected=2 each. Seed only 10 in storage (enough for
    // issue). After issue, work_center has 2.0 direct per material. Delete
    // the material[0] inventory at wc to create a deficit.
    let (wo_id, warehouse, wc, _storage, materials) =
        setup_draft_wo(&mut f, admin, "610", 3, 10.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (st, _) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st, StatusCode::OK);

    // Starve material[0] at the work-center: drop its inventory to 1.0 (only
    // 50% of required).
    sqlx::query(
        "UPDATE inventory SET quantity = 1.0 \
         WHERE product_id = $1 AND location_id = $2",
    )
    .bind(materials[0])
    .bind(wc)
    .execute(&state.pool)
    .await
    .unwrap();

    // SNAPSHOT before.
    let before = snapshot_counts(&state.pool, wo_id).await;

    let (status, body) = post_action(
        &state,
        &token,
        wo_id,
        "complete",
        json!({ "fg_expiration_date": null }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT, "body={body}");
    assert_eq!(body["code"], "INSUFFICIENT_WORK_ORDER_STOCK");
    let missing = body["missing"].as_array().expect("missing list");
    assert!(!missing.is_empty(), "missing must have at least one entry");
    // Assert the missing list shape: {product_id, expected, available, shortfall}
    let starved = missing
        .iter()
        .find(|m| {
            m["product_id"].as_str().and_then(|s| s.parse::<Uuid>().ok())
                == Some(materials[0])
        })
        .expect("material[0] must be in missing");
    assert_eq!(starved["expected"].as_f64().unwrap(), 2.0);
    assert_eq!(starved["available"].as_f64().unwrap(), 1.0);
    assert_eq!(starved["shortfall"].as_f64().unwrap(), 1.0);

    // SNAPSHOT after — MUST be identical.
    let after = snapshot_counts(&state.pool, wo_id).await;
    assert_eq!(before, after, "row counts must be unchanged on failed complete");

    // Status stays in_progress.
    let status_row: (String,) =
        sqlx::query_as("SELECT status::text FROM work_orders WHERE id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(status_row.0, "in_progress");

    f.cleanup().await;
}

// ─── 6.11 — complete honors fg_expiration_date per has_expiry ────────

async fn setup_wo_for_complete(
    f: &mut Fixture,
    admin: Uuid,
    tag: &str,
    fg_has_expiry: bool,
) -> (Uuid, Uuid) {
    let warehouse = f.create_warehouse(&format!("WO-{tag}-{}", f.suffix)).await;
    let wc = f.create_work_center(warehouse, &format!("WC-{tag}-{}", f.suffix)).await;
    let storage = f.create_zone(warehouse, &format!("ZN-{tag}-{}", f.suffix)).await;
    let fg = f
        .create_product(&format!("fg-{tag}"), "raw_material", fg_has_expiry, true)
        .await;
    let m1 = f
        .create_product(&format!("m-{tag}"), "consumable", false, false)
        .await;
    let recipe = f
        .create_recipe_direct(
            &format!("Recipe-{tag}-{}", f.suffix),
            admin,
            &[(m1, 1.0)],
        )
        .await;
    f.seed_inventory(m1, storage, 5.0).await;

    let token = mint_token(&f.state, admin, "superadmin", vec![warehouse]);
    let (_st, body) = post_work_order(
        &f.state,
        &token,
        json!({
            "recipe_id": recipe,
            "fg_product_id": fg,
            "fg_quantity": 1.0,
            "warehouse_id": warehouse,
            "work_center_location_id": wc,
        }),
    )
    .await;
    let wo_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    f.wo_ids.push(wo_id);

    let (st, _) = post_action(&f.state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st, StatusCode::OK);

    (wo_id, warehouse)
}

#[tokio::test]
async fn test_6_11a_complete_with_has_expiry_true_honors_input_date() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse) = setup_wo_for_complete(&mut f, admin, "611a", true).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_action(
        &state,
        &token,
        wo_id,
        "complete",
        json!({ "fg_expiration_date": "2027-04-23" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={body}");

    let exp: (Option<NaiveDate>,) = sqlx::query_as(
        "SELECT pl.expiration_date FROM product_lots pl \
         WHERE pl.lot_number LIKE 'WO-' || (SELECT code FROM work_orders WHERE id = $1) || '-%' \
         LIMIT 1",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(exp.0, Some(NaiveDate::from_ymd_opt(2027, 4, 23).unwrap()));

    f.cleanup().await;
}

#[tokio::test]
async fn test_6_11b_complete_with_has_expiry_false_ignores_input_date() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse) = setup_wo_for_complete(&mut f, admin, "611b", false).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_action(
        &state,
        &token,
        wo_id,
        "complete",
        json!({ "fg_expiration_date": "2027-04-23" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={body}");

    // expiration_date must be NULL because FG.has_expiry=false.
    let exp: (Option<NaiveDate>,) = sqlx::query_as(
        "SELECT pl.expiration_date FROM product_lots pl \
         WHERE pl.lot_number LIKE 'WO-' || (SELECT code FROM work_orders WHERE id = $1) || '-%' \
         LIMIT 1",
    )
    .bind(wo_id)
    .fetch_one(&state.pool)
    .await
    .unwrap();
    assert_eq!(exp.0, None, "non-expiring FG must store NULL expiration");

    f.cleanup().await;
}

// ─── 6.12 — cancel from draft ────────────────────────────────────────

#[tokio::test]
async fn test_6_12_cancel_from_draft_no_reversals() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse, _wc, _storage, _materials) =
        setup_draft_wo(&mut f, admin, "612", 2, 10.0).await;

    let mv_before: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(mv_before.0, 0);

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (status, body) = post_action(&state, &token, wo_id, "cancel", json!({})).await;
    assert_eq!(status, StatusCode::OK, "body={body}");
    assert_eq!(body["status"], "cancelled");
    assert!(body["cancelled_at"].is_string());

    let mv_after: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(mv_after.0, 0, "draft cancel must not create movements");

    f.cleanup().await;
}

// ─── 6.13 — cancel from in_progress reverses transfers ───────────────

#[tokio::test]
async fn test_6_13_cancel_from_in_progress_reverses_transfers() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    let (wo_id, warehouse, wc, storage, materials) =
        setup_draft_wo(&mut f, admin, "613", 3, 10.0).await;

    // Snapshot S1: (product, location) → quantity over the 4 touched cells
    // (storage + wc per material).
    let mut s1: HashMap<(Uuid, Uuid), f64> = HashMap::new();
    for m in &materials {
        for loc in [storage, wc] {
            let q: Option<(f64,)> = sqlx::query_as(
                "SELECT quantity::float8 FROM inventory \
                 WHERE product_id = $1 AND location_id = $2",
            )
            .bind(m)
            .bind(loc)
            .fetch_optional(&state.pool)
            .await
            .unwrap();
            s1.insert((*m, loc), q.map(|r| r.0).unwrap_or(0.0));
        }
    }

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (st, _) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st, StatusCode::OK);

    let (status, body) = post_action(&state, &token, wo_id, "cancel", json!({})).await;
    assert_eq!(status, StatusCode::OK, "body={body}");
    assert_eq!(body["status"], "cancelled");

    // Assert 3 wo_cancel_reversal transfers with swapped from/to.
    let reversals: Vec<(Option<Uuid>, Option<Uuid>, f64, Uuid)> = sqlx::query_as(
        "SELECT from_location_id, to_location_id, quantity::float8, product_id \
         FROM movements \
         WHERE work_order_id = $1 AND movement_reason = 'wo_cancel_reversal' \
         ORDER BY created_at ASC",
    )
    .bind(wo_id)
    .fetch_all(&state.pool)
    .await
    .unwrap();
    assert_eq!(reversals.len(), 3);
    for (from, to, qty, product_id) in &reversals {
        assert_eq!(*from, Some(wc), "reversal from must be work_center");
        assert_eq!(*to, Some(storage), "reversal to must be original storage");
        assert_eq!(*qty, 2.0, "reversal qty matches recipe item qty");
        assert!(materials.contains(product_id));
    }

    // Snapshot S3: compare with S1 — every cell must match.
    let mut s3: HashMap<(Uuid, Uuid), f64> = HashMap::new();
    for m in &materials {
        for loc in [storage, wc] {
            let q: Option<(f64,)> = sqlx::query_as(
                "SELECT quantity::float8 FROM inventory \
                 WHERE product_id = $1 AND location_id = $2",
            )
            .bind(m)
            .bind(loc)
            .fetch_optional(&state.pool)
            .await
            .unwrap();
            s3.insert((*m, loc), q.map(|r| r.0).unwrap_or(0.0));
        }
    }
    for (key, q1) in &s1 {
        let q3 = s3.get(key).copied().unwrap_or(0.0);
        assert_eq!(
            *q1, q3,
            "net inventory change non-zero at {key:?}: S1={q1}, S3={q3}"
        );
    }

    f.cleanup().await;
}

// ─── 6.14 — GET /work-orders filters ─────────────────────────────────

#[tokio::test]
async fn test_6_14_list_filter_by_status_warehouse_workcenter() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    // Two warehouses, each with its own work_center. Create 2 WOs per
    // warehouse; then advance one of them into different statuses.
    let wh_a = f.create_warehouse(&format!("WO-614A-{}", f.suffix)).await;
    let wc_a = f.create_work_center(wh_a, &format!("WCA-{}", f.suffix)).await;
    let storage_a = f.create_zone(wh_a, &format!("ZNA-{}", f.suffix)).await;

    let wh_b = f.create_warehouse(&format!("WO-614B-{}", f.suffix)).await;
    let wc_b = f.create_work_center(wh_b, &format!("WCB-{}", f.suffix)).await;
    let _storage_b = f.create_zone(wh_b, &format!("ZNB-{}", f.suffix)).await;

    let fg = f.create_product("fg-614", "raw_material", false, true).await;
    let m = f.create_product("m-614", "consumable", false, false).await;
    let recipe = f
        .create_recipe_direct(&format!("Recipe-614-{}", f.suffix), admin, &[(m, 1.0)])
        .await;
    f.seed_inventory(m, storage_a, 20.0).await;

    let token_both = mint_token(&state, admin, "superadmin", vec![wh_a, wh_b]);

    // Create 1 WO in each warehouse.
    let (_st, body1) = post_work_order(
        &state,
        &token_both,
        json!({
            "recipe_id": recipe, "fg_product_id": fg, "fg_quantity": 1.0,
            "warehouse_id": wh_a, "work_center_location_id": wc_a,
        }),
    )
    .await;
    let wo_a: Uuid = body1["id"].as_str().unwrap().parse().unwrap();
    f.wo_ids.push(wo_a);

    let (_st, body2) = post_work_order(
        &state,
        &token_both,
        json!({
            "recipe_id": recipe, "fg_product_id": fg, "fg_quantity": 1.0,
            "warehouse_id": wh_b, "work_center_location_id": wc_b,
        }),
    )
    .await;
    let wo_b: Uuid = body2["id"].as_str().unwrap().parse().unwrap();
    f.wo_ids.push(wo_b);

    // Cancel wh_b's WO from draft so it's in a different status.
    let (_st, _) = post_action(&state, &token_both, wo_b, "cancel", json!({})).await;

    async fn list(
        state: &AppState,
        token: &str,
        query: &str,
    ) -> Value {
        let app = app_router(state.clone());
        let uri = format!("/work-orders?per_page=500{query}");
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

    // status=draft — every returned row has status=draft AND our wo_a is in it.
    let by_status = list(&state, &token_both, "&status=draft").await;
    let arr = by_status["data"].as_array().unwrap();
    for row in arr {
        assert_eq!(row["status"], "draft");
    }
    let ids: Vec<Uuid> = arr
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(ids.contains(&wo_a));
    assert!(!ids.contains(&wo_b));

    // status=cancelled contains wo_b.
    let by_cancelled = list(&state, &token_both, "&status=cancelled").await;
    let ids_c: Vec<Uuid> = by_cancelled["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(ids_c.contains(&wo_b));

    // warehouse filter: wh_a returns wo_a only (from our set).
    let by_wh_a = list(&state, &token_both, &format!("&warehouse_id={wh_a}")).await;
    let ids_wh: Vec<Uuid> = by_wh_a["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(ids_wh.contains(&wo_a));
    assert!(!ids_wh.contains(&wo_b));

    // work_center filter.
    let by_wc_a = list(
        &state,
        &token_both,
        &format!("&work_center_location_id={wc_a}"),
    )
    .await;
    let ids_wc: Vec<Uuid> = by_wc_a["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    assert!(ids_wc.contains(&wo_a));
    assert!(!ids_wc.contains(&wo_b));

    // Combined filter: warehouse=A + status=draft returns wo_a only.
    let combined = list(
        &state,
        &token_both,
        &format!("&warehouse_id={wh_a}&status=draft"),
    )
    .await;
    for row in combined["data"].as_array().unwrap() {
        assert_eq!(row["status"], "draft");
        assert_eq!(
            row["warehouse_id"].as_str().unwrap().parse::<Uuid>().unwrap(),
            wh_a
        );
    }

    // Invalid status → 4xx, not 500.
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri("/work-orders?status=invalid")
        .header(AUTHORIZATION, format!("Bearer {token_both}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let st = resp.status();
    assert!(
        st == StatusCode::UNPROCESSABLE_ENTITY || st == StatusCode::BAD_REQUEST,
        "expected 4xx for bad status, got {st}"
    );

    f.cleanup().await;
}

// ─── 6.15 — GET /movements?work_order_id= returns tied rows ──────────

#[tokio::test]
async fn test_6_15_movements_filtered_by_work_order_id() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;

    // 6-material WO → 6 wo_issue + 6 back_flush + 1 production_output = 13.
    let (wo_id, warehouse, _wc, _storage, _materials) =
        setup_draft_wo(&mut f, admin, "615", 6, 10.0).await;

    let token = mint_token(&state, admin, "superadmin", vec![warehouse]);
    let (st1, _) = post_action(&state, &token, wo_id, "issue", json!({})).await;
    assert_eq!(st1, StatusCode::OK);
    let (st2, _) = post_action(
        &state,
        &token,
        wo_id,
        "complete",
        json!({ "fg_expiration_date": null }),
    )
    .await;
    assert_eq!(st2, StatusCode::OK);

    let app = app_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri(format!("/movements?work_order_id={wo_id}&per_page=100"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let rows = body["data"].as_array().expect("data array");
    assert_eq!(
        rows.len(),
        13,
        "expected 6 issue + 6 back_flush + 1 production_output = 13, got {}",
        rows.len()
    );

    // Every returned row must be tied to this WO. The movements response
    // shape in this codebase does not serialize work_order_id in the DTO
    // (confirmed in routes/movements.rs — MovementResponse omits it). So we
    // cross-check via the DB count.
    let db_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movements WHERE work_order_id = $1")
            .bind(wo_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(db_count.0, 13);

    f.cleanup().await;
}

// ─── 6.16 — PATCH /products/{id}/class blocked by is_manufactured ────

#[tokio::test]
async fn test_6_16_reclassify_blocked_while_is_manufactured_true() {
    let state = state_or_skip!();
    let mut f = Fixture::new(state.clone()).await;
    let admin = superadmin_id(&state.pool).await;
    let token = mint_token(&state, admin, "superadmin", vec![]);

    // Product starts raw_material + is_manufactured=true, NO history.
    let pid = f
        .create_product("prod-616", "raw_material", false, true)
        .await;

    // Attempt 1: PATCH class to consumable → 422 PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL.
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(json!({ "product_class": "consumable" }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL");

    // Class unchanged.
    let cls: (String, bool) =
        sqlx::query_as("SELECT product_class::text, is_manufactured FROM products WHERE id = $1")
            .bind(pid)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(cls.0, "raw_material");
    assert!(cls.1);

    // Step 2: PATCH /products/{id} setting is_manufactured=false.
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PUT")
        .uri(format!("/products/{pid}"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(json!({ "is_manufactured": false }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // PUT is the usual method for update in this codebase — confirmed from
    // routes/products.rs. If PATCH is also mapped, either works.
    assert!(
        resp.status().is_success(),
        "update is_manufactured failed: {}",
        resp.status()
    );

    // Step 3: PATCH class to consumable → 2xx.
    let app = app_router(state.clone());
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/products/{pid}/class"))
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(json!({ "product_class": "consumable" }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Final state: consumable, is_manufactured=false.
    let final_row: (String, bool) =
        sqlx::query_as("SELECT product_class::text, is_manufactured FROM products WHERE id = $1")
            .bind(pid)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(final_row.0, "consumable");
    assert!(!final_row.1);

    f.cleanup().await;
}
