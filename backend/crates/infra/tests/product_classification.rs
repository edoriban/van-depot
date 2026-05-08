// Repo-level integration tests for the Product Classification change.
//
// Covers Phase 6 items that need direct repo access:
//   6.2  — `product_repo::create` rejects has_expiry=true for tool_spare.
//   6.10 — `alerts_repo::get_stock_alerts` excludes tool_spare products.
//   6.11 — `cycle_count_repo::create` excludes tool_spare from the item snapshot.
//   6.12 — `receive_lot` writes an inventory row + entry movement with
//          `lot_id = NULL` for tool_spare and consumable-no-expiry paths.
//   + `create_lot` guards for tool_spare and consumable-no-expiry (Lots spec).
//   + `tool_instances_repo::insert` cross-class guard.
//
// HTTP/API-layer assertions (status codes, JSON shape, role guards) live in
// `backend/crates/api/tests/product_classification.rs`.
//
// All tests connect to a real Postgres via `DATABASE_URL` and clean up after
// themselves. When the DB is unreachable tests early-return via `pool_or_skip!`
// so CI without a DB is not broken (mirrors the pattern used in
// `reception_flow.rs`).

use chrono::Utc;
use sqlx::PgPool;
use std::env;
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_domain::models::enums::{LocationType, ProductClass, UnitType};
use vandepot_domain::models::receive_outcome::ReceiveOutcome;
use vandepot_infra::repositories::{
    alerts_repo, cycle_count_repo, location_repo, lots_repo, product_repo, tool_instances_repo,
    warehouse_repo,
};

// ─── Test harness ────────────────────────────────────────────────────

async fn maybe_pool() -> Option<PgPool> {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();

    let url = env::var("DATABASE_URL").ok()?;
    PgPool::connect(&url).await.ok()
}

macro_rules! pool_or_skip {
    () => {
        match maybe_pool().await {
            Some(p) => p,
            None => {
                eprintln!("SKIP: no DATABASE_URL available");
                return;
            }
        }
    };
}

/// Bag of ids created by a single test; dropped at the end via `cleanup`.
struct TestData {
    pool: PgPool,
    tenant_id: Uuid,
    warehouse_ids: Vec<Uuid>,
    product_ids: Vec<Uuid>,
    cycle_count_ids: Vec<Uuid>,
    user_id: Uuid,
}

impl TestData {
    async fn new(pool: PgPool) -> Self {
        let user_id: (Uuid,) =
            sqlx::query_as("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("seed superadmin must exist");
        let tenant_id: (Uuid,) = sqlx::query_as(
            "SELECT id FROM tenants WHERE slug = 'dev' AND deleted_at IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("dev tenant must exist — run `make reset-db`");

        Self {
            pool,
            tenant_id: tenant_id.0,
            warehouse_ids: Vec::new(),
            product_ids: Vec::new(),
            cycle_count_ids: Vec::new(),
            user_id: user_id.0,
        }
    }

    async fn create_warehouse(&mut self, name: &str) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let wh = warehouse_repo::create(&mut conn, self.tenant_id, name, None)
            .await
            .expect("warehouse create");
        self.warehouse_ids.push(wh.id);
        wh.id
    }

    /// Create a product of any class via the repo (exercises the app-layer
    /// validation path). `suffix` keeps SKUs unique across parallel tests.
    async fn create_product(
        &mut self,
        suffix: &str,
        class: ProductClass,
        has_expiry: bool,
        min_stock: f64,
    ) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let name = format!("Test {suffix}");
        let sku = format!("PC-{suffix}");
        let product = product_repo::create(
            &mut conn,
            self.tenant_id,
            &name,
            &sku,
            None,
            None,
            UnitType::Piece,
            class,
            has_expiry,
            false, // is_manufactured (Batch 2: existing tests do not assert on this flag)
            min_stock,
            None,
            Some(self.user_id),
        )
        .await
        .expect("product create");
        self.product_ids.push(product.id);
        product.id
    }

    async fn create_zone(&self, warehouse_id: Uuid, name: &str) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let loc = location_repo::create(
            &mut conn,
            self.tenant_id,
            warehouse_id,
            None,
            LocationType::Zone,
            name,
            None,
        )
        .await
        .expect("zone create");
        loc.id
    }

    async fn reception_id(&self, warehouse_id: Uuid) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        location_repo::find_reception_by_warehouse(&mut conn, self.tenant_id, warehouse_id)
            .await
            .expect("find_reception")
            .expect("reception exists")
            .id
    }

    async fn cleanup(&self) {
        for ccid in &self.cycle_count_ids {
            let _ = sqlx::query("DELETE FROM cycle_count_items WHERE cycle_count_id = $1")
                .bind(ccid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM cycle_counts WHERE id = $1")
                .bind(ccid)
                .execute(&self.pool)
                .await;
        }
        for wid in &self.warehouse_ids {
            let _ = sqlx::query(
                "DELETE FROM movements \
                 WHERE from_location_id IN (SELECT id FROM locations WHERE warehouse_id = $1) \
                    OR to_location_id   IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM inventory_lots \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM inventory \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.pool)
            .await;
            let _ = sqlx::query(
                "DELETE FROM tool_instances \
                 WHERE location_id IN (SELECT id FROM locations WHERE warehouse_id = $1)",
            )
            .bind(wid)
            .execute(&self.pool)
            .await;
            let _ = sqlx::query("DELETE FROM locations WHERE warehouse_id = $1")
                .bind(wid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM warehouses WHERE id = $1")
                .bind(wid)
                .execute(&self.pool)
                .await;
        }
        for pid in &self.product_ids {
            let _ = sqlx::query("DELETE FROM tool_instances WHERE product_id = $1")
                .bind(pid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM movements WHERE product_id = $1")
                .bind(pid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM inventory WHERE product_id = $1")
                .bind(pid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query(
                "DELETE FROM inventory_lots WHERE product_lot_id IN \
                    (SELECT id FROM product_lots WHERE product_id = $1)",
            )
            .bind(pid)
            .execute(&self.pool)
            .await;
            let _ = sqlx::query("DELETE FROM product_lots WHERE product_id = $1")
                .bind(pid)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM products WHERE id = $1")
                .bind(pid)
                .execute(&self.pool)
                .await;
        }
    }
}

// ─── 6.2 — product_repo::create rejects tool_spare + has_expiry=true ─

#[tokio::test]
async fn test_6_2_create_rejects_tool_spare_with_expiry() {
    let pool = pool_or_skip!();
    let td = TestData::new(pool.clone()).await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    let suffix = Uuid::new_v4().to_string();
    let res = product_repo::create(
        &mut conn,
        td.tenant_id,
        &format!("Bad tool {}", &suffix[..8]),
        &format!("BAD-TS-{}", &suffix[..8]),
        None,
        None,
        UnitType::Piece,
        ProductClass::ToolSpare,
        true,  // invalid: tool_spare may never have has_expiry = true
        false, // is_manufactured
        0.0,
        None,
        Some(td.user_id),
    )
    .await;
    drop(conn);

    match res {
        Err(DomainError::Validation(msg)) => {
            assert!(
                msg.contains("tool_spare") || msg.contains("has_expiry"),
                "unexpected message: {msg}"
            );
        }
        other => panic!("expected Validation, got {other:?}"),
    }

    // Confirm no row was persisted with this SKU.
    let cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM products WHERE sku = $1")
            .bind(format!("BAD-TS-{}", &suffix[..8]))
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt.0, 0);

    td.cleanup().await;
}

/// Happy path: tool_spare with has_expiry=false MUST succeed.
#[tokio::test]
async fn test_6_2_create_tool_spare_without_expiry_succeeds() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::ToolSpare, false, 0.0)
        .await;

    let row: (ProductClass, bool) =
        sqlx::query_as("SELECT product_class, has_expiry FROM products WHERE id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0, ProductClass::ToolSpare);
    assert!(!row.1);

    td.cleanup().await;
}

// ─── Lots §: create_lot guards (spec: "Direct create_lot for tool_spare fails") ─

#[tokio::test]
async fn test_create_lot_rejects_tool_spare() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::ToolSpare, false, 0.0)
        .await;

    let res = lots_repo::create_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        None,
        None,
        None,
        None,
    )
    .await;
    assert!(
        matches!(res, Err(DomainError::ProductClassDoesNotSupportLots)),
        "expected ProductClassDoesNotSupportLots for tool_spare (got unexpected Ok/other err)"
    );
    drop(res);

    // No row in product_lots.
    let cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt.0, 0);

    td.cleanup().await;
}

#[tokio::test]
async fn test_create_lot_rejects_consumable_without_expiry() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::Consumable, false, 0.0)
        .await;

    let res = lots_repo::create_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        None,
        None,
        None,
        None,
    )
    .await;
    assert!(
        matches!(res, Err(DomainError::ProductClassDoesNotSupportLots)),
        "expected ProductClassDoesNotSupportLots for consumable w/o expiry"
    );
    drop(res);

    td.cleanup().await;
}

#[tokio::test]
async fn test_create_lot_allows_consumable_with_expiry() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::Consumable, true, 0.0)
        .await;

    let row = lots_repo::create_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        None,
        Some(Utc::now().date_naive()),
        None,
        None,
    )
    .await
    .expect("create_lot should succeed for consumable + has_expiry");

    assert_eq!(row.product_id, pid);

    td.cleanup().await;
}

#[tokio::test]
async fn test_create_lot_allows_raw_material() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::RawMaterial, false, 0.0)
        .await;

    let row = lots_repo::create_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        None,
        None,
        None,
        None,
    )
    .await
    .expect("create_lot should succeed for raw_material");

    assert_eq!(row.product_id, pid);

    td.cleanup().await;
}

// ─── 6.12 — receive_lot direct_inventory matrix (infra layer) ────────

/// Helper: invoke `receive_lot` and assert it returned a `DirectInventory`
/// variant; return its fields for further inspection.
#[track_caller]
fn expect_direct_inventory(outcome: ReceiveOutcome) -> (Uuid, Uuid, Uuid, Uuid, f64) {
    match outcome {
        ReceiveOutcome::DirectInventory {
            inventory_id,
            movement_id,
            product_id,
            location_id,
            quantity,
        } => (inventory_id, movement_id, product_id, location_id, quantity),
        ReceiveOutcome::Lot(_) => {
            panic!("expected DirectInventory, got Lot")
        }
    }
}

#[track_caller]
fn expect_lot_outcome(
    outcome: ReceiveOutcome,
) -> vandepot_domain::models::product_lot::ProductLot {
    match outcome {
        ReceiveOutcome::Lot(lot) => lot,
        ReceiveOutcome::DirectInventory { .. } => {
            panic!("expected Lot, got DirectInventory")
        }
    }
}

#[tokio::test]
async fn test_6_12_receive_tool_spare_writes_direct_inventory() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-TS-{}", Uuid::new_v4())).await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::ToolSpare, false, 0.0)
        .await;
    let rcp = td.reception_id(wid).await;

    let outcome = lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        42.0,
        0.0,
        None,
        None,
        None,
        td.user_id,
        None,
        None,
        None,
    )
    .await
    .expect("receive_lot tool_spare succeeds");

    let (inv_id, mv_id, out_pid, out_loc, out_qty) = expect_direct_inventory(outcome);
    assert_eq!(out_pid, pid);
    assert_eq!(out_loc, rcp);
    assert_eq!(out_qty, 42.0);

    // inventory row present at Recepción with no lot linkage.
    let inv: (Uuid, Uuid, f64) = sqlx::query_as(
        "SELECT id, location_id, quantity::float8 FROM inventory WHERE id = $1",
    )
    .bind(inv_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(inv.0, inv_id);
    assert_eq!(inv.1, rcp);
    assert_eq!(inv.2, 42.0);

    // Movement present; crucially, movements carries no lot_id column — we
    // assert it via joining back to inventory_lots (no row must exist for
    // this product at Recepción).
    let inv_lot_cnt: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM inventory_lots il \
         JOIN product_lots pl ON il.product_lot_id = pl.id \
         WHERE pl.product_id = $1",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(inv_lot_cnt.0, 0, "tool_spare receive must not create any lot");

    // product_lots stays empty too.
    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    // The returned movement id should point at a row with
    // movement_type=entry, reason=purchase_receive, to=reception.
    let mv: (String, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT movement_reason, from_location_id, to_location_id \
         FROM movements WHERE id = $1",
    )
    .bind(mv_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mv.0, "purchase_receive");
    assert_eq!(mv.1, None);
    assert_eq!(mv.2, Some(rcp));

    td.cleanup().await;
}

#[tokio::test]
async fn test_6_12_receive_consumable_no_expiry_writes_direct_inventory() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-CN-{}", Uuid::new_v4())).await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::Consumable, false, 0.0)
        .await;
    let rcp = td.reception_id(wid).await;

    let outcome = lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        17.5,
        0.0,
        None,
        None,
        None,
        td.user_id,
        None,
        None,
        None,
    )
    .await
    .expect("receive_lot consumable w/o expiry succeeds");

    let (_, _, _, out_loc, out_qty) = expect_direct_inventory(outcome);
    assert_eq!(out_loc, rcp);
    assert_eq!(out_qty, 17.5);

    // No lot created.
    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    // Inventory at Recepción for this product.
    let inv_qty: (f64,) = sqlx::query_as(
        "SELECT quantity::float8 FROM inventory WHERE product_id = $1 AND location_id = $2",
    )
    .bind(pid)
    .bind(rcp)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(inv_qty.0, 17.5);

    td.cleanup().await;
}

#[tokio::test]
async fn test_6_12_receive_raw_material_still_creates_lot() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-RM-{}", Uuid::new_v4())).await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::RawMaterial, false, 0.0)
        .await;
    let rcp = td.reception_id(wid).await;

    let outcome = lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        10.0,
        0.0,
        None,
        None,
        None,
        td.user_id,
        None,
        None,
        None,
    )
    .await
    .expect("receive_lot raw_material succeeds");

    let lot = expect_lot_outcome(outcome);
    assert_eq!(lot.product_id, pid);

    // inventory_lots exists for this lot at Recepción.
    let il_cnt: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM inventory_lots WHERE product_lot_id = $1 AND location_id = $2",
    )
    .bind(lot.id)
    .bind(rcp)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(il_cnt.0, 1);

    td.cleanup().await;
}

#[tokio::test]
async fn test_6_12_receive_consumable_with_expiry_creates_lot() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-CE-{}", Uuid::new_v4())).await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::Consumable, true, 0.0)
        .await;
    let rcp = td.reception_id(wid).await;

    let outcome = lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        8.0,
        0.0,
        None,
        None,
        Some(Utc::now().date_naive()),
        td.user_id,
        None,
        None,
        None,
    )
    .await
    .expect("receive_lot consumable+expiry succeeds");

    let lot = expect_lot_outcome(outcome);

    let il_cnt: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM inventory_lots WHERE product_lot_id = $1 AND location_id = $2",
    )
    .bind(lot.id)
    .bind(rcp)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(il_cnt.0, 1);

    td.cleanup().await;
}

// ─── 6.10 — alerts exclude tool_spare ────────────────────────────────

#[tokio::test]
async fn test_6_10_alerts_exclude_tool_spare_products() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-ALERT-{}", Uuid::new_v4()))
        .await;
    // Tool-spare product with min_stock > 0; no stock = would trigger an
    // alert for a non-tool product.
    let tool_pid = td
        .create_product(
            &format!("alrtts-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::ToolSpare,
            false,
            5.0,
        )
        .await;
    // Raw material control: should trigger the alert (min_stock=5, stock=0).
    let raw_pid = td
        .create_product(
            &format!("alrtrm-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::RawMaterial,
            false,
            5.0,
        )
        .await;

    // Seed inventory = 0 for both products at a Zone location (alerts query
    // joins inventory i, so we need a row). Phase B B4: bind tenant_id.
    let zone = td.create_zone(wid, "Zona-Alert").await;
    for pid in [tool_pid, raw_pid] {
        sqlx::query(
            "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
             VALUES ($1, $2, $3, 0)",
        )
        .bind(td.tenant_id)
        .bind(pid)
        .bind(zone)
        .execute(&pool)
        .await
        .expect("seed inventory");
    }

    let alerts = alerts_repo::get_stock_alerts(&mut *pool.acquire().await.unwrap(), None, Some(wid))
        .await
        .expect("get_stock_alerts");

    let has_tool = alerts.iter().any(|a| a.product_id == tool_pid);
    let has_raw = alerts.iter().any(|a| a.product_id == raw_pid);

    assert!(!has_tool, "tool_spare product MUST NOT appear in alerts");
    assert!(
        has_raw,
        "raw_material below min_stock MUST appear (control)"
    );

    td.cleanup().await;
}

// ─── 6.11 — cycle_count excludes tool_spare + tool_instances guard ──

#[tokio::test]
async fn test_6_11_cycle_count_excludes_tool_spare_items() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-CYC-{}", Uuid::new_v4()))
        .await;
    let zone = td.create_zone(wid, "Zona-Cyc").await;

    let raw_pid = td
        .create_product(
            &format!("cycrm-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::RawMaterial,
            false,
            0.0,
        )
        .await;
    let tool_pid = td
        .create_product(
            &format!("cycts-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::ToolSpare,
            false,
            0.0,
        )
        .await;

    // Seed inventory qty > 0 for both at the same zone (cycle_count only
    // picks qty > 0). Phase B B4: bind tenant_id.
    for pid in [raw_pid, tool_pid] {
        sqlx::query(
            "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
             VALUES ($1, $2, $3, 7)",
        )
        .bind(td.tenant_id)
        .bind(pid)
        .bind(zone)
        .execute(&pool)
        .await
        .expect("seed inventory");
    }

    let cc = cycle_count_repo::create(&mut *pool.acquire().await.unwrap(),
        td.tenant_id,
        wid,
        &format!("Count-{}", Uuid::new_v4()),
        None,
        td.user_id,
    )
    .await
    .expect("cycle_count create");
    td.cycle_count_ids.push(cc.id);

    let items: Vec<(Uuid,)> =
        sqlx::query_as("SELECT product_id FROM cycle_count_items WHERE cycle_count_id = $1")
            .bind(cc.id)
            .fetch_all(&pool)
            .await
            .unwrap();

    let product_ids: Vec<Uuid> = items.into_iter().map(|(p,)| p).collect();
    assert!(
        product_ids.contains(&raw_pid),
        "raw_material should appear in cycle count items (control)"
    );
    assert!(
        !product_ids.contains(&tool_pid),
        "tool_spare MUST NOT appear in cycle count items"
    );

    td.cleanup().await;
}

#[tokio::test]
async fn test_6_11_tool_instances_insert_guards_class() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let raw_pid = td
        .create_product(
            &format!("tirm-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::RawMaterial,
            false,
            0.0,
        )
        .await;
    let tool_pid = td
        .create_product(
            &format!("tits-{}", &Uuid::new_v4().to_string()[..8]),
            ProductClass::ToolSpare,
            false,
            0.0,
        )
        .await;

    // Raw material path → PRODUCT_CLASS_MISMATCH validation error.
    let err = tool_instances_repo::insert(&mut *pool.acquire().await.unwrap(),
        td.tenant_id,
        raw_pid,
        format!("SN-{}", Uuid::new_v4()),
        None,
    )
    .await
    .expect_err("raw_material must be rejected");
    match err {
        DomainError::Validation(msg) => {
            assert!(
                msg.contains("PRODUCT_CLASS_MISMATCH"),
                "expected PRODUCT_CLASS_MISMATCH prefix, got: {msg}"
            );
        }
        other => panic!("expected Validation, got {other:?}"),
    }

    // No rows were persisted.
    let cnt_raw: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM tool_instances WHERE product_id = $1")
            .bind(raw_pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt_raw.0, 0);

    // tool_spare path → succeeds.
    let inst = tool_instances_repo::insert(&mut *pool.acquire().await.unwrap(),
        td.tenant_id,
        tool_pid,
        format!("SN-{}", Uuid::new_v4()),
        None,
    )
    .await
    .expect("tool_spare insert should succeed");
    assert_eq!(inst.product_id, tool_pid);
    assert_eq!(inst.status, "available");

    td.cleanup().await;
}

// ─── Reclassify lock: all three blocker kinds ───────────────────────

#[tokio::test]
async fn test_reclassify_locks_on_movement() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-RCL1-{}", Uuid::new_v4()))
        .await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::RawMaterial, false, 0.0)
        .await;

    // Receive → creates a movement for this product.
    let _ = lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        &format!("LOT-{}", Uuid::new_v4()),
        wid,
        5.0,
        0.0,
        None,
        None,
        None,
        td.user_id,
        None,
        None,
        None,
    )
    .await
    .expect("receive ok");

    let mut conn = pool.acquire().await.expect("acquire conn");
    let err = product_repo::reclassify(
        &mut conn,
        td.tenant_id,
        pid,
        ProductClass::Consumable,
        Some(td.user_id),
    )
    .await
    .expect_err("locked reclassify must err");
    drop(conn);

    match err {
        DomainError::ClassLocked {
            movements,
            lots,
            tool_instances,
        } => {
            assert!(movements >= 1, "expected movements blocker, got {movements}");
            assert!(lots >= 1, "raw_material receive creates a lot too");
            assert_eq!(tool_instances, 0);
        }
        other => panic!("expected ClassLocked, got {other:?}"),
    }

    // class unchanged in DB.
    let cls: (ProductClass,) =
        sqlx::query_as("SELECT product_class FROM products WHERE id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cls.0, ProductClass::RawMaterial);

    td.cleanup().await;
}

#[tokio::test]
async fn test_reclassify_locks_on_tool_instance() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::ToolSpare, false, 0.0)
        .await;

    tool_instances_repo::insert(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, format!("SN-{}", Uuid::new_v4()), None)
        .await
        .expect("tool_instance insert");

    let mut conn = pool.acquire().await.expect("acquire conn");
    let err = product_repo::reclassify(
        &mut conn,
        td.tenant_id,
        pid,
        ProductClass::RawMaterial,
        Some(td.user_id),
    )
    .await
    .expect_err("locked by tool_instance");
    drop(conn);

    match err {
        DomainError::ClassLocked {
            tool_instances, ..
        } => {
            assert!(tool_instances >= 1);
        }
        other => panic!("expected ClassLocked, got {other:?}"),
    }

    td.cleanup().await;
}

#[tokio::test]
async fn test_reclassify_succeeds_on_fresh_product() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::RawMaterial, false, 0.0)
        .await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    let updated = product_repo::reclassify(
        &mut conn,
        td.tenant_id,
        pid,
        ProductClass::Consumable,
        Some(td.user_id),
    )
    .await
    .expect("reclassify fresh product should succeed");
    drop(conn);

    assert_eq!(updated.product_class, ProductClass::Consumable);
    assert_eq!(updated.id, pid);

    td.cleanup().await;
}

#[tokio::test]
async fn test_class_lock_status_fresh_is_unlocked() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8], ProductClass::RawMaterial, false, 0.0)
        .await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    let status = product_repo::class_lock_status(&mut conn, td.tenant_id, pid)
        .await
        .expect("class_lock_status");
    drop(conn);

    assert!(!status.locked);
    assert_eq!(status.movements, 0);
    assert_eq!(status.lots, 0);
    assert_eq!(status.tool_instances, 0);

    td.cleanup().await;
}
