// Phase 6.2 unit coverage for `inventory_repo::pick_for_consumption`.
//
// The helper is the lynchpin of `work_orders_repo::complete`'s back-flush
// logic (design §6c). These tests exercise its behaviour in isolation before
// the complete flow depends on it — the dry-run / execute split in complete
// is easy to get wrong, so the FEFO contract is best nailed down here first.
//
// Cases covered (task 6.2 a–f + NULL-expiration bonus):
//   6.2a — zero lots + sufficient direct inventory     → Full (single direct pick)
//   6.2b — zero lots + insufficient direct inventory   → Short (direct pick + shortfall)
//   6.2c — one lot exactly matching quantity           → Full (single lot pick)
//   6.2d — two lots, FEFO order (earlier exp first)    → Full (two lot picks)
//   6.2e — lot-backed + direct combined                → Full (lot picks + direct pick)
//   6.2f — total short: lots + direct still short      → Short
//   6.2g — NULL-expiration lot ordered LAST            → earlier-dated lot drawn first
//
// All tests rollback via `tx.rollback()` at the end so the shared dev DB
// stays clean. `pool_or_skip!` returns when no `DATABASE_URL` is set.

use chrono::NaiveDate;
use sqlx::PgPool;
use std::env;
use uuid::Uuid;

use vandepot_domain::ports::warehouse_repository::WarehouseRepository;
use vandepot_infra::repositories::{
    inventory_repo::{self, PickOutcome},
    warehouse_repo::PgWarehouseRepository,
};

// ── Harness ──────────────────────────────────────────────────────────

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

/// Picks are compared up to a small float epsilon — back-flush quantities are
/// f64 throughout (project convention) and FEFO arithmetic may produce tiny
/// accumulated error.
fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

/// Assert a `Full` outcome with the expected number of picks, matching
/// `(lot_is_some, quantity)` per pick in order.
#[track_caller]
fn assert_full(outcome: &PickOutcome, expected: &[(bool, f64)]) {
    match outcome {
        PickOutcome::Full(picks) => {
            assert_eq!(
                picks.len(),
                expected.len(),
                "Full pick count mismatch (got {:?})",
                picks
            );
            for (i, (p, (lot_is_some, qty))) in picks.iter().zip(expected.iter()).enumerate() {
                assert_eq!(
                    p.lot_id.is_some(),
                    *lot_is_some,
                    "pick {i} lot_id presence mismatch"
                );
                assert_eq!(
                    p.product_lot_id.is_some(),
                    *lot_is_some,
                    "pick {i} product_lot_id presence mismatch"
                );
                assert!(
                    approx_eq(p.quantity, *qty),
                    "pick {i} quantity: want {qty}, got {}",
                    p.quantity
                );
            }
        }
        other => panic!("expected Full, got {other:?}"),
    }
}

#[track_caller]
fn assert_short(outcome: &PickOutcome, expected_shortfall: f64, expected_pick_count: usize) {
    match outcome {
        PickOutcome::Short { picks, shortfall } => {
            assert!(
                approx_eq(*shortfall, expected_shortfall),
                "shortfall: want {expected_shortfall}, got {shortfall}"
            );
            assert_eq!(
                picks.len(),
                expected_pick_count,
                "Short pick count mismatch (picks: {picks:?})"
            );
        }
        other => panic!("expected Short, got {other:?}"),
    }
}

/// Fixture: one warehouse + one work-center + one raw_material product +
/// one fresh user_id. The caller adds lots / direct inventory per test.
struct PickFixture {
    pool: PgPool,
    product_id: Uuid,
    location_id: Uuid,
    warehouse_id: Uuid,
    _user_id: Uuid,
    suffix: String,
}

impl PickFixture {
    async fn setup(pool: &PgPool) -> Self {
        let suffix = Uuid::new_v4().to_string()[..8].to_string();

        // Unique warehouse per fixture keeps parallel tests hermetic.
        let wh_repo = PgWarehouseRepository::new(pool.clone());
        let warehouse = wh_repo
            .create(&format!("FEFO-WH-{suffix}"), None)
            .await
            .expect("warehouse create");

        // Provision a work_center via direct SQL (bypassing the
        // LocationRepository guards because `work_center` requires
        // `is_system=true`, which the repo doesn't expose). The migration-3
        // CHECK constraint `chk_work_center_is_system` is what keeps the DB
        // honest; we set is_system=true explicitly.
        let loc_id: (Uuid,) = sqlx::query_as(
            "INSERT INTO locations \
                (warehouse_id, location_type, name, is_system, pos_x, pos_y, width, height) \
             VALUES ($1, 'work_center', $2, true, 100, 100, 80, 80) \
             RETURNING id",
        )
        .bind(warehouse.id)
        .bind(format!("WC-{suffix}"))
        .fetch_one(pool)
        .await
        .expect("work_center create");

        // Raw-material product via direct SQL — the repo's create signature
        // is nice but we don't need the role guards here.
        let user_id: (Uuid,) =
            sqlx::query_as("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1")
                .fetch_one(pool)
                .await
                .expect("superadmin exists in seed");

        let prod_id: (Uuid,) = sqlx::query_as(
            "INSERT INTO products \
                (name, sku, unit_of_measure, product_class, has_expiry, is_manufactured, min_stock, created_by) \
             VALUES ($1, $2, 'piece', 'raw_material', true, false, 0, $3) \
             RETURNING id",
        )
        .bind(format!("FEFO Prod {suffix}"))
        .bind(format!("FEFO-{suffix}"))
        .bind(user_id.0)
        .fetch_one(pool)
        .await
        .expect("product create");

        Self {
            pool: pool.clone(),
            product_id: prod_id.0,
            location_id: loc_id.0,
            warehouse_id: warehouse.id,
            _user_id: user_id.0,
            suffix,
        }
    }

    /// Insert a lot + its inventory_lots row at `location_id` + the matching
    /// `inventory` delta. Returns `(product_lot_id, inventory_lot_id)`.
    async fn seed_lot(
        &self,
        lot_suffix: &str,
        quantity: f64,
        expiration_date: Option<NaiveDate>,
    ) -> (Uuid, Uuid) {
        let pl: (Uuid,) = sqlx::query_as(
            "INSERT INTO product_lots \
                (product_id, lot_number, expiration_date, received_quantity, quality_status) \
             VALUES ($1, $2, $3, $4, 'approved') \
             RETURNING id",
        )
        .bind(self.product_id)
        .bind(format!("LOT-{}-{}", self.suffix, lot_suffix))
        .bind(expiration_date)
        .bind(quantity)
        .fetch_one(&self.pool)
        .await
        .expect("product_lot insert");

        let il: (Uuid,) = sqlx::query_as(
            "INSERT INTO inventory_lots (product_lot_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             RETURNING id",
        )
        .bind(pl.0)
        .bind(self.location_id)
        .bind(quantity)
        .fetch_one(&self.pool)
        .await
        .expect("inventory_lots insert");

        // Upsert `inventory` — the project convention (§6c critical note) is
        // that `inventory.quantity` SUMS lot-backed + direct.
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(self.product_id)
        .bind(self.location_id)
        .bind(quantity)
        .execute(&self.pool)
        .await
        .expect("inventory upsert (lot-backed)");

        (pl.0, il.0)
    }

    /// Add `delta` direct (non-lot) inventory to the (product, location) row.
    /// Does NOT create `inventory_lots` — the total on `inventory` still
    /// reflects lots-plus-direct, so this increments by `delta`.
    async fn seed_direct_inventory(&self, delta: f64) {
        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (product_id, location_id) \
             DO UPDATE SET quantity = inventory.quantity + $3, updated_at = NOW()",
        )
        .bind(self.product_id)
        .bind(self.location_id)
        .bind(delta)
        .execute(&self.pool)
        .await
        .expect("inventory upsert (direct)");
    }

    async fn cleanup(self) {
        let _ = sqlx::query(
            "DELETE FROM inventory_lots \
             WHERE product_lot_id IN (SELECT id FROM product_lots WHERE product_id = $1)",
        )
        .bind(self.product_id)
        .execute(&self.pool)
        .await;
        let _ = sqlx::query("DELETE FROM product_lots WHERE product_id = $1")
            .bind(self.product_id)
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("DELETE FROM inventory WHERE product_id = $1")
            .bind(self.product_id)
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("DELETE FROM products WHERE id = $1")
            .bind(self.product_id)
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("DELETE FROM locations WHERE warehouse_id = $1")
            .bind(self.warehouse_id)
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("DELETE FROM warehouses WHERE id = $1")
            .bind(self.warehouse_id)
            .execute(&self.pool)
            .await;

    }
}

// ── 6.2a — zero lots + sufficient direct inventory ──────────────────

#[tokio::test]
async fn pick_for_consumption_full_from_direct_inventory() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;
    fx.seed_direct_inventory(10.0).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 4.0)
        .await
        .expect("pick ok");

    // One direct pick of exactly 4.0, no lot references.
    assert_full(&outcome, &[(false, 4.0)]);

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2b — zero lots + insufficient direct inventory ────────────────

#[tokio::test]
async fn pick_for_consumption_short_from_direct_inventory() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;
    fx.seed_direct_inventory(3.0).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 5.0)
        .await
        .expect("pick ok");

    // Picks the 3.0 that's available, reports 2.0 shortfall.
    assert_short(&outcome, 2.0, 1);
    if let PickOutcome::Short { picks, .. } = &outcome {
        assert!(picks[0].lot_id.is_none());
        assert!(approx_eq(picks[0].quantity, 3.0));
    }

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2c — one lot exactly matching quantity ────────────────────────

#[tokio::test]
async fn pick_for_consumption_full_single_lot_exact_match() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;
    let exp = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
    fx.seed_lot("only", 5.0, Some(exp)).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 5.0)
        .await
        .expect("pick ok");

    // Single lot-backed pick of 5.0.
    assert_full(&outcome, &[(true, 5.0)]);

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2d — two lots, FEFO order (earlier exp first) ─────────────────

#[tokio::test]
async fn pick_for_consumption_full_fefo_two_lots() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;

    // Earlier-expiration lot (June) must be drawn BEFORE the later-expiration
    // lot (September). Seed them in "wrong" insertion order to prove the
    // ORDER BY drives the plan, not insert time.
    let late = NaiveDate::from_ymd_opt(2027, 9, 1).unwrap();
    let early = NaiveDate::from_ymd_opt(2027, 6, 1).unwrap();
    let (_pl_late, _) = fx.seed_lot("late", 10.0, Some(late)).await;
    let (_pl_early, _) = fx.seed_lot("early", 3.0, Some(early)).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 7.0)
        .await
        .expect("pick ok");

    // Earlier-expiry lot fully consumed (3.0), then 4.0 from the later lot.
    assert_full(&outcome, &[(true, 3.0), (true, 4.0)]);

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2e — lot-backed + direct combined ─────────────────────────────

#[tokio::test]
async fn pick_for_consumption_full_lots_plus_direct_fallthrough() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;

    // One lot of 2.0, plus 3.0 of direct (non-lot) inventory. Total 5.0.
    // Requesting 4.0 consumes the full lot (2.0) and 2.0 of direct.
    fx.seed_lot(
        "partial",
        2.0,
        Some(NaiveDate::from_ymd_opt(2027, 2, 1).unwrap()),
    )
    .await;
    // seed_lot already adds 2.0 to `inventory`; bump it by 3.0 more so
    // `inventory.quantity = 5.0` (sum of 2 lot-backed + 3 direct).
    fx.seed_direct_inventory(3.0).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 4.0)
        .await
        .expect("pick ok");

    // Lot-backed 2.0 then direct 2.0.
    assert_full(&outcome, &[(true, 2.0), (false, 2.0)]);

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2f — total short: lots + direct + still short ─────────────────

#[tokio::test]
async fn pick_for_consumption_short_combined_still_insufficient() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;

    // One lot of 1.5 + 1.0 direct = 2.5 available. Request 5.0 → 2.5 short.
    fx.seed_lot(
        "small",
        1.5,
        Some(NaiveDate::from_ymd_opt(2027, 4, 1).unwrap()),
    )
    .await;
    fx.seed_direct_inventory(1.0).await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 5.0)
        .await
        .expect("pick ok");

    // 2 picks (1 lot + 1 direct), shortfall = 2.5.
    assert_short(&outcome, 2.5, 2);
    if let PickOutcome::Short { picks, .. } = &outcome {
        let lot_sum: f64 = picks
            .iter()
            .filter(|p| p.lot_id.is_some())
            .map(|p| p.quantity)
            .sum();
        let direct_sum: f64 = picks
            .iter()
            .filter(|p| p.lot_id.is_none())
            .map(|p| p.quantity)
            .sum();
        assert!(approx_eq(lot_sum, 1.5));
        assert!(approx_eq(direct_sum, 1.0));
    }

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}

// ── 6.2g — NULL-expiration lot ordered LAST ─────────────────────────

#[tokio::test]
async fn pick_for_consumption_null_expiration_sorts_last() {
    let pool = pool_or_skip!();
    let fx = PickFixture::setup(&pool).await;

    // Lot with NULL expiration must come AFTER the dated lot (NULLS LAST).
    // Seed NULL first to prove insertion order doesn't influence the pick.
    let (_pl_null, _) = fx.seed_lot("null-exp", 5.0, None).await;
    let (_pl_dated, _) = fx
        .seed_lot(
            "dated",
            5.0,
            Some(NaiveDate::from_ymd_opt(2027, 8, 1).unwrap()),
        )
        .await;

    let mut tx = pool.begin().await.expect("tx begin");
    let outcome = inventory_repo::pick_for_consumption(&mut tx, fx.product_id, fx.location_id, 2.0)
        .await
        .expect("pick ok");

    // Only the dated lot should be touched (2.0 drawn, still 3.0 left on it).
    match &outcome {
        PickOutcome::Full(picks) => {
            assert_eq!(picks.len(), 1, "expected single pick from dated lot");
            assert!(picks[0].lot_id.is_some());
            assert!(approx_eq(picks[0].quantity, 2.0));

            // Verify the pick's product_lot_id maps to the DATED lot.
            // Cheap way: re-query the lot's expiration_date through the
            // pick's product_lot_id and confirm it's non-null.
            let pl_id = picks[0].product_lot_id.expect("product_lot_id set");
            let exp: (Option<NaiveDate>,) = sqlx::query_as(
                "SELECT expiration_date FROM product_lots WHERE id = $1",
            )
            .bind(pl_id)
            .fetch_one(&mut *tx)
            .await
            .expect("exp lookup");
            assert!(
                exp.0.is_some(),
                "pick drew from NULL-exp lot (should have been last)"
            );
        }
        other => panic!("expected Full, got {other:?}"),
    }

    tx.rollback().await.expect("rollback");
    fx.cleanup().await;
}
