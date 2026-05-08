// Integration tests for the receiving-location-flow change.
//
// These tests target the live dev Postgres DB (reads `DATABASE_URL` from env
// or the project `.env`). If `DATABASE_URL` is unset, every test bails out
// early via `maybe_pool()` so CI without a DB is not broken.
//
// Each test creates its own warehouse + ancillary data with unique UUIDs and
// cleans up at the end. That keeps tests hermetic without depending on
// `sqlx::test` macros (the project doesn't enable `sqlx/macros`).

use chrono::Utc;
use sqlx::PgPool;
use std::env;
use uuid::Uuid;

use vandepot_domain::error::{DomainError, SYSTEM_LOCATION_PROTECTED};
use vandepot_domain::models::enums::LocationType;
use vandepot_domain::models::product_lot::ProductLot;
use vandepot_domain::models::receive_outcome::ReceiveOutcome;
use vandepot_infra::repositories::{inventory_repo, location_repo, lots_repo, warehouse_repo};

// The no-lot receive matrix lives in `product_classification.rs` (Batch 5).
// Tests in this file create products via the legacy SQL helper
// `TestData::create_product` (which omits `product_class` and relies on the
// DB default of `raw_material` + `has_expiry=false`), so every receive here
// takes the lot path — this helper unwraps `ReceiveOutcome::Lot`.
#[track_caller]
fn expect_lot(outcome: ReceiveOutcome) -> ProductLot {
    match outcome {
        ReceiveOutcome::Lot(lot) => lot,
        ReceiveOutcome::DirectInventory { .. } => {
            panic!("expected ReceiveOutcome::Lot for raw_material product")
        }
    }
}

// ─── Test harness ────────────────────────────────────────────────────

/// Returns `Some(pool)` if a `DATABASE_URL` is reachable, `None` otherwise.
/// Tests that need the DB short-circuit cleanly when no DB is configured.
async fn maybe_pool() -> Option<PgPool> {
    // Try to read from .env one directory up (project root) on a best-effort basis.
    // The dev setup always has DATABASE_URL in the project .env.
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();

    let url = env::var("DATABASE_URL").ok()?;
    PgPool::connect(&url).await.ok()
}

/// Guard struct that tears down test-created rows on drop.
///
/// We scope everything to a single warehouse created per test; deleting the
/// warehouse cascades through inventory, inventory_lots, and movements (via
/// the JOIN-free cleanup below).
struct TestData {
    pool: PgPool,
    tenant_id: Uuid,
    warehouse_ids: Vec<Uuid>,
    product_ids: Vec<Uuid>,
    user_id: Uuid,
}

impl TestData {
    async fn new(pool: PgPool) -> Self {
        // Reuse the seed superadmin as the actor on every test movement.
        let user_id: (Uuid,) = sqlx::query_as(
            "SELECT id FROM users WHERE is_superadmin = true LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("seed superadmin must exist — run `cargo run` once to seed");

        // Phase B batch 1: every tenant-scoped repo call needs a tenant_id.
        // The `dev` tenant is seeded by `make reset-db` / RUN_SEED_DEFAULT_TENANT.
        let tenant_id: (Uuid,) = sqlx::query_as(
            "SELECT id FROM tenants WHERE slug = 'dev' AND deleted_at IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("dev tenant must exist — run `make reset-db` to seed");

        Self {
            pool,
            tenant_id: tenant_id.0,
            warehouse_ids: Vec::new(),
            product_ids: Vec::new(),
            user_id: user_id.0,
        }
    }

    async fn create_warehouse(&mut self, name: &str) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let wh = warehouse_repo::create(&mut conn, self.tenant_id, name, None)
            .await
            .expect("warehouse create should succeed");
        self.warehouse_ids.push(wh.id);
        wh.id
    }

    async fn create_product(&mut self, sku_suffix: &str) -> Uuid {
        // Phase B B2: products carry NOT NULL tenant_id; bind explicitly.
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO products (tenant_id, name, sku, unit_of_measure) \
             VALUES ($1, $2, $3, 'piece') \
             RETURNING id",
        )
        .bind(self.tenant_id)
        .bind(format!("Test Product {sku_suffix}"))
        .bind(format!("TST-{sku_suffix}"))
        .fetch_one(&self.pool)
        .await
        .expect("product insert");
        self.product_ids.push(row.0);
        row.0
    }

    async fn create_location(
        &self,
        warehouse_id: Uuid,
        name: &str,
        location_type: LocationType,
    ) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let loc = location_repo::create(
            &mut conn,
            self.tenant_id,
            warehouse_id,
            None,
            location_type,
            name,
            None,
        )
        .await
        .expect("location create");
        loc.id
    }

    async fn reception_id(&self, warehouse_id: Uuid) -> Uuid {
        let mut conn = self.pool.acquire().await.expect("acquire conn");
        let loc = location_repo::find_reception_by_warehouse(&mut conn, self.tenant_id, warehouse_id)
            .await
            .expect("find_reception")
            .expect("reception must exist post-warehouse-create");
        loc.id
    }

    async fn inventory_qty(&self, product_id: Uuid, location_id: Uuid) -> f64 {
        let row: Option<(f64,)> = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory \
             WHERE product_id = $1 AND location_id = $2",
        )
        .bind(product_id)
        .bind(location_id)
        .fetch_optional(&self.pool)
        .await
        .expect("inventory query");
        row.map(|r| r.0).unwrap_or(0.0)
    }

    async fn inventory_lot_qty(&self, lot_id: Uuid, location_id: Uuid) -> f64 {
        let row: Option<(f64,)> = sqlx::query_as(
            "SELECT quantity::float8 FROM inventory_lots \
             WHERE product_lot_id = $1 AND location_id = $2",
        )
        .bind(lot_id)
        .bind(location_id)
        .fetch_optional(&self.pool)
        .await
        .expect("inventory_lots query");
        row.map(|r| r.0).unwrap_or(0.0)
    }

    async fn cleanup(&self) {
        // Order matters: movements -> inventory_lots -> inventory -> product_lots
        // -> locations -> warehouses -> products.
        for wid in &self.warehouse_ids {
            // Movements referencing any location in this warehouse.
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
                "DELETE FROM locations WHERE warehouse_id = $1",
            )
            .bind(wid)
            .execute(&self.pool)
            .await;

            let _ = sqlx::query("DELETE FROM warehouses WHERE id = $1")
                .bind(wid)
                .execute(&self.pool)
                .await;
        }

        for pid in &self.product_ids {
            // Nuke lots first (FK cascades inventory_lots; inventory/movements
            // for this product live under warehouses we already deleted).
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

macro_rules! pool_or_skip {
    () => {
        match maybe_pool().await {
            Some(p) => p,
            None => {
                eprintln!(
                    "SKIP: no DATABASE_URL available; skipping integration test"
                );
                return;
            }
        }
    };
}

// ─── Phase 5.1 — warehouse_repo ──────────────────────────────────────

/// PgWarehouseRepository::create MUST atomically insert the warehouse AND its
/// Recepción. After commit, `find_reception_by_warehouse` must find exactly
/// one row.
#[tokio::test]
async fn test_warehouse_create_inserts_reception_atomically() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let name = format!("WH-ATOMIC-{}", Uuid::new_v4());
    let wid = td.create_warehouse(&name).await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    let rcp = location_repo::find_reception_by_warehouse(&mut conn, td.tenant_id, wid)
        .await
        .expect("find_reception should not error")
        .expect("Reception must exist after warehouse creation");

    assert_eq!(rcp.warehouse_id, wid);
    assert_eq!(rcp.location_type, LocationType::Reception);
    assert!(rcp.is_system, "Reception row must have is_system=true");
    assert_eq!(rcp.name, "Recepción");
    assert_eq!(rcp.label.as_deref(), Some("RCP"));

    td.cleanup().await;
}

/// The partial unique index `idx_one_reception_per_warehouse` MUST prevent a
/// second Reception for the same warehouse. (Simulates what would happen if a
/// rogue code path tried to bypass the transactional create.)
#[tokio::test]
async fn test_duplicate_reception_rejected_by_unique_index() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-DUPE-{}", Uuid::new_v4())).await;

    let res = sqlx::query(
        "INSERT INTO locations \
            (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
         VALUES ($1, $2, 'reception', 'Recepción 2', 'RCP2', true, 0, 0, 100, 100)",
    )
    .bind(td.tenant_id)
    .bind(wid)
    .execute(&pool)
    .await;

    assert!(
        res.is_err(),
        "second Reception insert must violate the partial unique index"
    );

    td.cleanup().await;
}

// ─── Phase 5.2 — location_repo ───────────────────────────────────────

#[tokio::test]
async fn test_find_reception_by_warehouse_returns_exactly_one() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-FINDRCP-{}", Uuid::new_v4()))
        .await;

    // Sanity: exactly one row of location_type=reception.
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations \
         WHERE warehouse_id = $1 AND location_type = 'reception'",
    )
    .bind(wid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count.0, 1);

    td.cleanup().await;
}

#[tokio::test]
async fn test_delete_reception_returns_system_protected_conflict() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-DELRCP-{}", Uuid::new_v4()))
        .await;
    let rcp = td.reception_id(wid).await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    match location_repo::delete(&mut conn, td.tenant_id, rcp).await {
        Err(DomainError::Conflict(msg)) => {
            assert!(
                msg.starts_with(SYSTEM_LOCATION_PROTECTED),
                "message must begin with SYSTEM_LOCATION_PROTECTED, got: {msg}"
            );
        }
        other => panic!("expected Conflict, got {other:?}"),
    }

    td.cleanup().await;
}

#[tokio::test]
async fn test_update_reception_rename_is_rejected() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-RENRCP-{}", Uuid::new_v4()))
        .await;
    let rcp = td.reception_id(wid).await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    match location_repo::update(&mut conn, td.tenant_id, rcp, Some("Renamed"), None, None).await {
        Err(DomainError::Conflict(msg)) => {
            assert!(msg.starts_with(SYSTEM_LOCATION_PROTECTED));
        }
        other => panic!("expected Conflict, got {other:?}"),
    }

    td.cleanup().await;
}

#[tokio::test]
async fn test_update_regular_location_still_works() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-UPDREG-{}", Uuid::new_v4()))
        .await;
    let zone = td.create_location(wid, "Zona A", LocationType::Zone).await;

    let mut conn = pool.acquire().await.expect("acquire conn");
    let updated = location_repo::update(
        &mut conn,
        td.tenant_id,
        zone,
        Some("Zona A Renombrada"),
        None,
        None,
    )
    .await
    .expect("non-system rename should succeed");

    assert_eq!(updated.name, "Zona A Renombrada");

    td.cleanup().await;
}

// ─── Phase 5.3 — lots_repo: receive + transfer guards ───────────────

#[tokio::test]
async fn test_receive_lot_lands_at_reception() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-RCVRCP-{}", Uuid::new_v4()))
        .await;
    let pid = td
        .create_product(&Uuid::new_v4().to_string()[..8])
        .await;
    let rcp = td.reception_id(wid).await;

    let lot_number = format!("LOT-{}", Uuid::new_v4());
    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
            pid,
            &lot_number,
            wid,
            50.0,
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
        .expect("receive_lot should succeed"),
    );

    // inventory_lots MUST land at Reception.
    assert_eq!(td.inventory_lot_qty(lot.id, rcp).await, 50.0);
    // Main inventory too.
    assert_eq!(td.inventory_qty(pid, rcp).await, 50.0);

    // Movement MUST have to_location_id=reception AND reason='purchase_receive'.
    let mv: (Option<Uuid>, String) = sqlx::query_as(
        "SELECT to_location_id, movement_reason \
         FROM movements \
         WHERE product_id = $1 AND movement_reason = 'purchase_receive' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mv.0, Some(rcp));
    assert_eq!(mv.1, "purchase_receive");

    td.cleanup().await;
}

#[tokio::test]
async fn test_receive_lot_defect_movement_lands_at_reception() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td
        .create_warehouse(&format!("WH-DEFRCP-{}", Uuid::new_v4()))
        .await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = td.reception_id(wid).await;

    let _ = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
            pid,
            &format!("LOT-DEF-{}", Uuid::new_v4()),
            wid,
            10.0,
            3.0,
            None,
            None,
            None,
            td.user_id,
            None,
            None,
            None,
        )
        .await
        .expect("receive_lot with defect should succeed"),
    );

    // The defect movement must also target the Reception.
    let defect: (Option<Uuid>, String) = sqlx::query_as(
        "SELECT to_location_id, movement_reason \
         FROM movements \
         WHERE product_id = $1 AND movement_reason = 'quality_reject' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(defect.0, Some(rcp));

    td.cleanup().await;
}

#[tokio::test]
async fn test_transfer_lot_rejects_reception_source() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-TRFRCP-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = td.reception_id(wid).await;
    let zone = td.create_location(wid, "Zona", LocationType::Zone).await;

    // Seed a lot at Reception so the transfer otherwise would proceed.
    let lot_no = format!("LOT-{}", Uuid::new_v4());
    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, &lot_no, wid, 20.0, 0.0, None, None, None, td.user_id, None, None, None,
        )
        .await
        .unwrap(),
    );

    let res = lots_repo::transfer_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        lot.id,
        rcp,
        zone,
        5.0,
        td.user_id,
        None,
    )
    .await;

    match res {
        Err(DomainError::Validation(msg)) => {
            assert!(
                msg.contains("distribute") || msg.contains("Reception"),
                "unexpected error message: {msg}"
            );
        }
        other => panic!("expected Validation error, got {other:?}"),
    }

    td.cleanup().await;
}

// ─── Phase 5.4 — lots_repo::distribute_lot ─────────────────────────

#[tokio::test]
async fn test_distribute_lot_full_and_partial() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-DIST-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = td.reception_id(wid).await;
    let zone = td.create_location(wid, "Zona-A", LocationType::Zone).await;

    let lot_no = format!("LOT-{}", Uuid::new_v4());
    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, &lot_no, wid, 100.0, 0.0, None, None, None, td.user_id, None, None, None,
        )
        .await
        .unwrap(),
    );

    // Partial distribute 30.
    lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, lot.id, zone, 30.0, td.user_id, None)
        .await
        .expect("partial distribute should succeed");

    assert_eq!(td.inventory_lot_qty(lot.id, rcp).await, 70.0);
    assert_eq!(td.inventory_lot_qty(lot.id, zone).await, 30.0);

    // Now distribute the remaining 70 (full).
    lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, lot.id, zone, 70.0, td.user_id, None)
        .await
        .expect("full distribute should succeed");

    assert_eq!(td.inventory_lot_qty(lot.id, rcp).await, 0.0);
    assert_eq!(td.inventory_lot_qty(lot.id, zone).await, 100.0);

    // Movements should have reason='distribute_from_reception' for both hops.
    let cnt: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movements \
         WHERE product_id = $1 AND movement_reason = 'distribute_from_reception'",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cnt.0, 2);

    td.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_insufficient_quantity() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-DINS-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = td.create_location(wid, "Zona-A", LocationType::Zone).await;

    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid,
            &format!("LOT-{}", Uuid::new_v4()),
            wid, 20.0, 0.0, None, None, None, td.user_id, None, None, None,
        )
        .await
        .unwrap(),
    );

    let res = lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, lot.id, zone, 50.0, td.user_id, None).await;
    assert!(matches!(res, Err(DomainError::Validation(_))));

    td.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_rejects_reception_destination() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid_a = td.create_warehouse(&format!("WH-DDA-{}", Uuid::new_v4())).await;
    let wid_b = td.create_warehouse(&format!("WH-DDB-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp_b = td.reception_id(wid_b).await;

    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid,
            &format!("LOT-{}", Uuid::new_v4()),
            wid_a, 50.0, 0.0, None, None, None, td.user_id, None, None, None,
        )
        .await
        .unwrap(),
    );

    // destination is a Reception → must be rejected.
    let res = lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, lot.id, rcp_b, 10.0, td.user_id, None).await;
    assert!(
        matches!(res, Err(DomainError::Validation(_))),
        "expected Validation error for Reception destination, got {res:?}"
    );

    td.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_rejects_different_warehouse() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid_a = td.create_warehouse(&format!("WH-DWA-{}", Uuid::new_v4())).await;
    let wid_b = td.create_warehouse(&format!("WH-DWB-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone_b = td.create_location(wid_b, "Zona B", LocationType::Zone).await;

    let lot = expect_lot(
        lots_repo::receive_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid,
            &format!("LOT-{}", Uuid::new_v4()),
            wid_a, 50.0, 0.0, None, None, None, td.user_id, None, None, None,
        )
        .await
        .unwrap(),
    );

    let res = lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, lot.id, zone_b, 10.0, td.user_id, None).await;
    assert!(
        matches!(res, Err(DomainError::Validation(_))),
        "expected Validation error for cross-warehouse target, got {res:?}"
    );

    td.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_not_found() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;
    let wid = td.create_warehouse(&format!("WH-DNF-{}", Uuid::new_v4())).await;
    let zone = td.create_location(wid, "Z", LocationType::Zone).await;

    let bogus_lot = Uuid::new_v4();
    let res = lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, bogus_lot, zone, 1.0, td.user_id, None).await;
    assert!(matches!(res, Err(DomainError::NotFound(_))));

    td.cleanup().await;
}

#[tokio::test]
async fn test_distribute_lot_non_positive_quantity() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;
    let wid = td.create_warehouse(&format!("WH-DNQ-{}", Uuid::new_v4())).await;
    let zone = td.create_location(wid, "Z", LocationType::Zone).await;

    let res = lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, Uuid::new_v4(), zone, 0.0, td.user_id, None).await;
    assert!(matches!(res, Err(DomainError::Validation(_))));

    let res2 =
        lots_repo::distribute_lot(&mut *pool.acquire().await.unwrap(), td.tenant_id, Uuid::new_v4(), zone, -5.0, td.user_id, None).await;
    assert!(matches!(res2, Err(DomainError::Validation(_))));

    td.cleanup().await;
}

// ─── Phase 5.5 — inventory_repo::opening_balance ───────────────────

#[tokio::test]
async fn test_opening_balance_success_with_lot() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-OB1-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = td.create_location(wid, "Zona", LocationType::Zone).await;

    let lot_no = format!("LOT-OB-{}", Uuid::new_v4());
    inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id,
        pid,
        wid,
        zone,
        120.0,
        Some(&lot_no),
        Some(Utc::now().date_naive()),
        None,
        None,
        td.user_id,
        None,
    )
    .await
    .expect("opening_balance with lot should succeed");

    assert_eq!(td.inventory_qty(pid, zone).await, 120.0);

    let mv: (String, Option<Uuid>) = sqlx::query_as(
        "SELECT movement_reason, to_location_id \
         FROM movements \
         WHERE product_id = $1 AND movement_reason = 'initial_load' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mv.0, "initial_load");
    assert_eq!(mv.1, Some(zone));

    td.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_success_without_lot() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-OB2-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = td.create_location(wid, "Zona", LocationType::Zone).await;

    inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, wid, zone, 40.0, None, None, None, None, td.user_id, None,
    )
    .await
    .expect("opening_balance without lot should succeed");

    assert_eq!(td.inventory_qty(pid, zone).await, 40.0);

    // No product_lots row should exist for this product.
    let lot_cnt: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM product_lots WHERE product_id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lot_cnt.0, 0);

    td.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_rejects_reception_target() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-OB3-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let rcp = td.reception_id(wid).await;

    let res = inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, wid, rcp, 10.0, None, None, None, None, td.user_id, None,
    )
    .await;
    assert!(matches!(res, Err(DomainError::Validation(_))));

    td.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_rejects_wrong_warehouse() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid_a = td.create_warehouse(&format!("WH-OB4A-{}", Uuid::new_v4())).await;
    let wid_b = td.create_warehouse(&format!("WH-OB4B-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone_b = td.create_location(wid_b, "Z", LocationType::Zone).await;

    let res = inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, wid_a, zone_b, 10.0, None, None, None, None, td.user_id, None,
    )
    .await;
    assert!(matches!(res, Err(DomainError::Validation(_))));

    td.cleanup().await;
}

#[tokio::test]
async fn test_opening_balance_rejects_non_positive_quantity() {
    let pool = pool_or_skip!();
    let mut td = TestData::new(pool.clone()).await;

    let wid = td.create_warehouse(&format!("WH-OB5-{}", Uuid::new_v4())).await;
    let pid = td.create_product(&Uuid::new_v4().to_string()[..8]).await;
    let zone = td.create_location(wid, "Z", LocationType::Zone).await;

    let res = inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, wid, zone, 0.0, None, None, None, None, td.user_id, None,
    )
    .await;
    assert!(matches!(res, Err(DomainError::Validation(_))));

    let res2 = inventory_repo::opening_balance(&mut *pool.acquire().await.unwrap(), td.tenant_id, pid, wid, zone, -3.0, None, None, None, None, td.user_id, None,
    )
    .await;
    assert!(matches!(res2, Err(DomainError::Validation(_))));

    td.cleanup().await;
}

// ─── Phase 5.9 — migration idempotency (backfill) ──────────────────

/// Re-runs the backfill snippet and asserts NO new Recepción rows are inserted.
/// (The full migration already ran before these tests.)
#[tokio::test]
async fn test_migration_backfill_is_idempotent() {
    let pool = pool_or_skip!();

    // Count Reception rows before.
    let before: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations WHERE location_type = 'reception'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // Re-run the backfill insert; updated for B1 to project `w.tenant_id`
    // alongside `w.id` (the legacy migration inserted without tenant_id, but
    // post-B1 the column is NOT NULL).
    sqlx::query(
        r#"
        INSERT INTO locations
            (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
        SELECT w.tenant_id, w.id, 'reception', 'Recepción', 'RCP', true, 0, 0, 100, 100
        FROM warehouses w
        WHERE w.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM locations l
              WHERE l.warehouse_id = w.id AND l.location_type = 'reception'
          )
        "#,
    )
    .execute(&pool)
    .await
    .expect("idempotent backfill should not error on re-run");

    let after: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM locations WHERE location_type = 'reception'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(before.0, after.0, "re-running backfill must not duplicate rows");
}
