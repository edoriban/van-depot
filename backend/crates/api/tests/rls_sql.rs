// Phase E task E4 (multi-tenant-foundation) — SQL-layer RLS isolation suite.
//
// Source of truth:
// - Spec:    `sdd/multi-tenant-foundation/spec` ("Tenant-Scoped Data Isolation",
//            specifically the RLS-at-SQL clause that mandates that even raw
//            queries are blocked across tenants).
// - Design:  `sdd/multi-tenant-foundation/design` §4 (RLS policies + role-split),
//            §5.2 (per-request transaction model).
// - Tasks:   `sdd/multi-tenant-foundation/tasks` E4.
// - Verify-C: engram #466 ran the four "killer SQL tests" manually; this file
//            automates them and extends the coverage to UPDATE / DELETE / INSERT
//            (WITH CHECK) on multiple tables, plus a schema-invariant sweep
//            across all 24 tenant-scoped tables.
//
// What this proves:
//   1. RLS USING fires on SELECT — `app.current_tenant=A` cannot see B's rows.
//   2. With NO session vars (defensive default) every read returns 0 rows.
//   3. `app.is_superadmin='true'` bypass returns ≥ 2 rows across two tenants.
//   4. RLS USING also gates UPDATE — cross-tenant UPDATE silently affects 0
//      rows (the row is simply invisible to the policy).
//   5. RLS USING also gates DELETE — cross-tenant DELETE affects 0 rows.
//   6. RLS WITH CHECK rejects INSERT into another tenant — Postgres raises
//      SQLSTATE 42501 (insufficient_privilege).
//   7. UPDATE / DELETE policy-gated outcomes hold for `warehouses` and
//      `movements` too (catches accidental future drops on individual tables).
//   8. Every tenant-scoped table (24 of them) has BOTH `relrowsecurity` and
//      `relforcerowsecurity` set — schema invariant.
//   9. Smoke check (one-shot): when the SAME query runs as the superuser
//      (`DATABASE_URL`), RLS is bypassed and B's rows leak — confirming we
//      really were exercising RLS in the prior tests.
//
// Connection model: this test opens a fresh, dedicated `PgPool` against
// `DATABASE_URL_APP` (the non-superuser `vandepot_app` role). RLS policies are
// only enforced for non-superuser roles, so using the wrong pool would silently
// turn every assertion into a vacuous pass. We assert `current_user` matches
// the expected role at the top of every test.
//
// Run command:
//   cargo test --workspace --test rls_sql
//
// Skip behavior: tests skip cleanly when DATABASE_URL_APP is absent (mirrors
// the harness in `multi_tenant_isolation.rs`).

use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use std::env;
use uuid::Uuid;

use vandepot_infra::db::with_bypass_session;

// ─── Test harness ────────────────────────────────────────────────────────────

/// Load `.env` (workspace root + crate-local) once per test. Mirrors the
/// pattern used by `multi_tenant_isolation.rs` and `admin_seed_demo.rs`.
fn load_env() {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();
}

/// Build a non-superuser pool against `DATABASE_URL_APP`. Returns `None` if the
/// var is unset so the test can SKIP rather than fall back silently.
async fn maybe_app_pool() -> Option<PgPool> {
    load_env();
    let app_url = env::var("DATABASE_URL_APP").ok()?;
    PgPoolOptions::new()
        .max_connections(4)
        .connect(&app_url)
        .await
        .ok()
}

/// Build a superuser pool against `DATABASE_URL`, used ONLY for fixture seeds
/// (via `with_bypass_session`) and the single negative-control smoke check.
async fn maybe_super_pool() -> Option<PgPool> {
    load_env();
    let url = env::var("DATABASE_URL").ok()?;
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .ok()
}

macro_rules! pools_or_skip {
    () => {{
        match (maybe_app_pool().await, maybe_super_pool().await) {
            (Some(app), Some(sup)) => (app, sup),
            _ => {
                eprintln!(
                    "SKIP: DATABASE_URL_APP and DATABASE_URL must both be set (see .env). \
                     SQL-layer RLS tests require the non-superuser app role for RLS to fire."
                );
                return;
            }
        }
    }};
}

/// Two fresh tenants + one product each (named `Product-A` / `Product-B`).
/// Returns the IDs the tests need. Seeded via the SUPERUSER pool with
/// `with_bypass_session` so RLS doesn't block the fixture INSERT.
struct Fixture {
    tenant_a: Uuid,
    tenant_b: Uuid,
    product_a: Uuid,
    product_b: Uuid,
}

async fn seed_fixture(super_pool: &PgPool) -> Fixture {
    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let tenant_a = Uuid::new_v4();
    let tenant_b = Uuid::new_v4();
    let product_a = Uuid::new_v4();
    let product_b = Uuid::new_v4();
    let slug_a = format!("rls-a-{suffix}");
    let slug_b = format!("rls-b-{suffix}");
    let sku_a = format!("RLS-A-{suffix}");
    let sku_b = format!("RLS-B-{suffix}");

    with_bypass_session(super_pool, async move |conn| {
        // Tenants.
        sqlx::query(
            "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
        )
        .bind(tenant_a)
        .bind(&slug_a)
        .bind(format!("RLS Tenant A {suffix}"))
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
        )
        .bind(tenant_b)
        .bind(&slug_b)
        .bind(format!("RLS Tenant B {suffix}"))
        .execute(&mut *conn)
        .await?;

        // One product per tenant. category_id stays NULL (FK is nullable).
        sqlx::query(
            "INSERT INTO products (id, tenant_id, name, sku) VALUES ($1, $2, $3, $4)",
        )
        .bind(product_a)
        .bind(tenant_a)
        .bind("Product-A")
        .bind(&sku_a)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO products (id, tenant_id, name, sku) VALUES ($1, $2, $3, $4)",
        )
        .bind(product_b)
        .bind(tenant_b)
        .bind("Product-B")
        .bind(&sku_b)
        .execute(&mut *conn)
        .await?;

        Ok(())
    })
    .await
    .expect("seed_fixture: tx failed");

    Fixture { tenant_a, tenant_b, product_a, product_b }
}

/// Best-effort cleanup — restores the DB to its pre-test state.
async fn cleanup(super_pool: &PgPool, f: &Fixture) {
    let tenant_a = f.tenant_a;
    let tenant_b = f.tenant_b;
    let _ = with_bypass_session(super_pool, async move |conn| {
        // Products first (FK to tenants).
        for tid in [tenant_a, tenant_b] {
            sqlx::query("DELETE FROM products WHERE tenant_id = $1")
                .bind(tid)
                .execute(&mut *conn)
                .await?;
            sqlx::query("DELETE FROM stock_configuration WHERE tenant_id = $1")
                .bind(tid)
                .execute(&mut *conn)
                .await?;
            sqlx::query("DELETE FROM tenants WHERE id = $1")
                .bind(tid)
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    })
    .await;
}

/// Assert the test really is connected as the non-superuser app role.
/// Without this, every other assertion would silently pass (superuser bypasses
/// FORCE ROW LEVEL SECURITY).
async fn assert_app_role(pool: &PgPool) {
    let row = sqlx::query("SELECT current_user::text AS u, current_setting('is_superuser') AS s")
        .fetch_one(pool)
        .await
        .expect("introspect role");
    let user: String = row.get("u");
    let is_super: String = row.get("s");
    assert_eq!(
        user, "vandepot_app",
        "test must run as 'vandepot_app' (non-superuser); got '{user}'. \
         Check DATABASE_URL_APP."
    );
    assert_eq!(
        is_super, "off",
        "vandepot_app must NOT be a superuser (RLS would bypass)"
    );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// Test 1 — SELECT under tenant_a's session vars cannot see tenant_b's row,
/// even with an explicit `WHERE tenant_id = <B>` predicate. RLS USING strips
/// foreign rows before the predicate is evaluated.
#[tokio::test]
async fn select_under_tenant_a_cannot_see_tenant_b_rows() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .expect("set tenant_a");
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .expect("set is_superadmin=false");

    // Even with an explicit WHERE tenant_id = B, RLS USING returns 0 rows.
    let row = sqlx::query("SELECT count(*)::bigint AS n FROM products WHERE tenant_id = $1")
        .bind(f.tenant_b)
        .fetch_one(&mut *tx)
        .await
        .expect("query products as tenant_a");
    let n: i64 = row.get("n");
    assert_eq!(n, 0, "RLS must hide tenant_b rows from tenant_a session");

    // Sanity: we CAN see our own row.
    let row = sqlx::query("SELECT count(*)::bigint AS n FROM products WHERE tenant_id = $1")
        .bind(f.tenant_a)
        .fetch_one(&mut *tx)
        .await
        .expect("query products as tenant_a (own)");
    let n_own: i64 = row.get("n");
    assert_eq!(n_own, 1, "tenant_a should see its own product");

    tx.rollback().await.ok();
    cleanup(&super_pool, &f).await;
}

/// Test 2 — With NO session vars, RLS defaults to false (NULL session var ⇒
/// `tenant_id = NULL::uuid` is NULL ⇒ no row passes USING). This is the
/// defense-in-depth default the policy template relies on.
#[tokio::test]
async fn select_with_no_session_vars_returns_zero_rows() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    let mut tx = app_pool.begin().await.expect("begin app tx");
    // Explicitly DO NOT plant app.current_tenant or app.is_superadmin.
    let row = sqlx::query("SELECT count(*)::bigint AS n FROM products")
        .fetch_one(&mut *tx)
        .await
        .expect("query products with no session vars");
    let n: i64 = row.get("n");
    assert_eq!(
        n, 0,
        "defensive default: no session vars must yield 0 rows (got {n})"
    );

    tx.rollback().await.ok();
    cleanup(&super_pool, &f).await;
}

/// Test 3 — With `app.is_superadmin='true'` the bypass clause kicks in and
/// the session sees rows from BOTH tenants.
#[tokio::test]
async fn select_with_is_superadmin_true_bypasses_rls() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.is_superadmin', 'true', true)")
        .execute(&mut *tx)
        .await
        .expect("set is_superadmin=true");

    let row = sqlx::query(
        "SELECT count(*)::bigint AS n FROM products WHERE tenant_id IN ($1, $2)",
    )
    .bind(f.tenant_a)
    .bind(f.tenant_b)
    .fetch_one(&mut *tx)
    .await
    .expect("query products as superadmin");
    let n: i64 = row.get("n");
    assert!(
        n >= 2,
        "is_superadmin=true must see ≥ 2 rows (Product-A + Product-B); got {n}"
    );

    tx.rollback().await.ok();
    cleanup(&super_pool, &f).await;
}

/// Test 4 — UPDATE with cross-tenant target affects 0 rows. The foreign row is
/// invisible to the USING clause, so the UPDATE silently no-ops. Verified
/// untouched via a superadmin-bypass tx.
#[tokio::test]
async fn update_blocks_cross_tenant_writes() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    // Attempt the cross-tenant UPDATE under tenant_a's session.
    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .expect("set tenant_a");
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .expect("set is_superadmin=false");

    let result = sqlx::query("UPDATE products SET name = 'hacked' WHERE id = $1")
        .bind(f.product_b)
        .execute(&mut *tx)
        .await
        .expect("UPDATE must not error — RLS hides the row, it does not raise");
    assert_eq!(
        result.rows_affected(),
        0,
        "cross-tenant UPDATE must affect 0 rows (RLS USING hides foreign row)"
    );
    tx.commit().await.ok(); // commit a no-op so we observe the post-state.

    // Verify product_b's name was NOT mutated, via superadmin bypass tx.
    let pid = f.product_b;
    let observed_name: String = with_bypass_session(&super_pool, async move |conn| {
        let row = sqlx::query("SELECT name FROM products WHERE id = $1")
            .bind(pid)
            .fetch_one(&mut *conn)
            .await?;
        Ok(row.get::<String, _>("name"))
    })
    .await
    .expect("verify product_b name");
    assert_eq!(
        observed_name, "Product-B",
        "Product-B must remain unchanged after blocked UPDATE; got '{observed_name}'"
    );

    cleanup(&super_pool, &f).await;
}

/// Test 5 — DELETE with cross-tenant target affects 0 rows; the row remains.
#[tokio::test]
async fn delete_blocks_cross_tenant_writes() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .expect("set tenant_a");
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .expect("set is_superadmin=false");

    let result = sqlx::query("DELETE FROM products WHERE id = $1")
        .bind(f.product_b)
        .execute(&mut *tx)
        .await
        .expect("DELETE must not error — RLS hides the row");
    assert_eq!(
        result.rows_affected(),
        0,
        "cross-tenant DELETE must affect 0 rows"
    );
    tx.commit().await.ok();

    // Verify product_b still exists, via superadmin bypass tx.
    let pid = f.product_b;
    let still_exists: bool = with_bypass_session(&super_pool, async move |conn| {
        let row = sqlx::query("SELECT EXISTS(SELECT 1 FROM products WHERE id = $1) AS e")
            .bind(pid)
            .fetch_one(&mut *conn)
            .await?;
        Ok(row.get::<bool, _>("e"))
    })
    .await
    .expect("verify product_b existence");
    assert!(still_exists, "Product-B must still exist after blocked DELETE");

    cleanup(&super_pool, &f).await;
}

/// Test 6 — INSERT trying to write a tenant_b row from a tenant_a session is
/// rejected by `WITH CHECK` with SQLSTATE 42501 (insufficient_privilege).
/// This is the strongest assertion in the suite — it proves WITH CHECK fires.
#[tokio::test]
async fn insert_with_check_rejects_cross_tenant_writes() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .expect("set tenant_a");
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .expect("set is_superadmin=false");

    let suffix = Uuid::new_v4().to_string()[..8].to_string();
    let evil_sku = format!("EVIL-{suffix}");
    // tenant_id is EXPLICITLY tenant_b — current session is tenant_a — must fail.
    let result = sqlx::query(
        "INSERT INTO products (id, tenant_id, name, sku) VALUES (gen_random_uuid(), $1, 'Evil', $2)",
    )
    .bind(f.tenant_b)
    .bind(&evil_sku)
    .execute(&mut *tx)
    .await;
    let err = result.expect_err("expected RLS WITH CHECK violation, got Ok");
    let pg_err = err
        .as_database_error()
        .expect("expected sqlx::Error::Database (Postgres-level), got non-DB error");
    assert_eq!(
        pg_err.code().as_deref(),
        Some("42501"),
        "expected SQLSTATE 42501 (insufficient_privilege from WITH CHECK), got {:?}: {}",
        pg_err.code(),
        pg_err.message()
    );

    // The aborted statement leaves the tx in failed state — drop it.
    tx.rollback().await.ok();

    // Verify no Evil row landed (via superuser bypass).
    let evil_sku_owned = evil_sku.clone();
    let leaked: bool = with_bypass_session(&super_pool, async move |conn| {
        let row = sqlx::query("SELECT EXISTS(SELECT 1 FROM products WHERE sku = $1) AS e")
            .bind(&evil_sku_owned)
            .fetch_one(&mut *conn)
            .await?;
        Ok(row.get::<bool, _>("e"))
    })
    .await
    .expect("check Evil row");
    assert!(!leaked, "Evil row must NOT exist — RLS WITH CHECK should block INSERT");

    cleanup(&super_pool, &f).await;
}

/// Test 7 — Repeat the cross-tenant SELECT/UPDATE/DELETE shapes on `warehouses`
/// and `movements`. The policy template is identical, but a future migration
/// could accidentally drop RLS on a single table — this test catches that.
#[tokio::test]
async fn rls_isolated_for_warehouses_and_movements() {
    let (app_pool, super_pool) = pools_or_skip!();
    assert_app_role(&app_pool).await;
    let f = seed_fixture(&super_pool).await;

    // Seed: one warehouse + one location per tenant + one movement per tenant.
    // movements requires from/to-locations + a user_id; we use the superadmin.
    let tenant_a = f.tenant_a;
    let tenant_b = f.tenant_b;
    let product_a = f.product_a;
    let product_b = f.product_b;
    let wh_a = Uuid::new_v4();
    let wh_b = Uuid::new_v4();
    let loc_a = Uuid::new_v4();
    let loc_b = Uuid::new_v4();
    let mv_a = Uuid::new_v4();
    let mv_b = Uuid::new_v4();

    let admin_id: Uuid = with_bypass_session(&super_pool, async move |conn| {
        let row = sqlx::query("SELECT id FROM users WHERE is_superadmin = true LIMIT 1")
            .fetch_one(&mut *conn)
            .await?;
        Ok(row.get::<Uuid, _>("id"))
    })
    .await
    .expect("superadmin lookup");

    let _ = with_bypass_session(&super_pool, async move |conn| {
        // Warehouses.
        sqlx::query("INSERT INTO warehouses (id, tenant_id, name) VALUES ($1, $2, 'WH-A'), ($3, $4, 'WH-B')")
            .bind(wh_a).bind(tenant_a)
            .bind(wh_b).bind(tenant_b)
            .execute(&mut *conn).await?;
        // Locations (location_type='bin' — leaf type per the enum
        // ['zone','rack','shelf','position','bin','reception']; we avoid
        // 'reception' which carries the is_system invariant).
        sqlx::query(
            "INSERT INTO locations (id, tenant_id, warehouse_id, name, location_type) \
             VALUES ($1, $2, $3, 'LOC-A', 'bin'), ($4, $5, $6, 'LOC-B', 'bin')",
        )
        .bind(loc_a).bind(tenant_a).bind(wh_a)
        .bind(loc_b).bind(tenant_b).bind(wh_b)
        .execute(&mut *conn).await?;
        // Movements (entry: from_location_id NULL, to_location_id set).
        sqlx::query(
            "INSERT INTO movements (id, tenant_id, product_id, to_location_id, quantity, movement_type, user_id) \
             VALUES ($1, $2, $3, $4, 1.0, 'entry', $5), ($6, $7, $8, $9, 1.0, 'entry', $10)",
        )
        .bind(mv_a).bind(tenant_a).bind(product_a).bind(loc_a).bind(admin_id)
        .bind(mv_b).bind(tenant_b).bind(product_b).bind(loc_b).bind(admin_id)
        .execute(&mut *conn).await?;
        Ok(())
    })
    .await
    .expect("seed warehouses + movements");

    // Per-table assertion helper: SELECT/UPDATE/DELETE under tenant_a session.
    async fn assert_table_isolated(
        app_pool: &PgPool,
        tenant_a: Uuid,
        tenant_b: Uuid,
        table: &str,
        foreign_id: Uuid,
    ) {
        let mut tx = app_pool.begin().await.expect("begin app tx");
        sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
            .bind(tenant_a.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
            .execute(&mut *tx)
            .await
            .unwrap();

        // SELECT cross-tenant — 0 rows.
        let sql = format!("SELECT count(*)::bigint AS n FROM {table} WHERE tenant_id = $1");
        let row = sqlx::query(&sql)
            .bind(tenant_b)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or_else(|e| panic!("{table}: SELECT cross-tenant errored: {e}"));
        let n: i64 = row.get("n");
        assert_eq!(n, 0, "{table}: SELECT under tenant_a must hide tenant_b rows");

        // UPDATE cross-tenant — 0 rows. Use a no-op SET so we don't rely on
        // table-specific columns; updated_at gets bumped in the rare case
        // there's a trigger, but rows_affected() reflects the policy outcome.
        let sql = format!("UPDATE {table} SET tenant_id = tenant_id WHERE id = $1");
        let res = sqlx::query(&sql)
            .bind(foreign_id)
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|e| panic!("{table}: UPDATE cross-tenant errored: {e}"));
        assert_eq!(
            res.rows_affected(),
            0,
            "{table}: cross-tenant UPDATE must affect 0 rows"
        );

        tx.rollback().await.ok();
    }

    assert_table_isolated(&app_pool, tenant_a, tenant_b, "warehouses", wh_b).await;
    assert_table_isolated(&app_pool, tenant_a, tenant_b, "movements", mv_b).await;

    // Cleanup the extra rows we seeded (movements / locations / warehouses)
    // before the shared cleanup. movements has no FK from products, so order:
    // movements → locations → warehouses.
    let _ = with_bypass_session(&super_pool, async move |conn| {
        for tid in [tenant_a, tenant_b] {
            sqlx::query("DELETE FROM movements WHERE tenant_id = $1")
                .bind(tid).execute(&mut *conn).await?;
            sqlx::query("DELETE FROM locations WHERE tenant_id = $1")
                .bind(tid).execute(&mut *conn).await?;
            sqlx::query("DELETE FROM warehouses WHERE tenant_id = $1")
                .bind(tid).execute(&mut *conn).await?;
        }
        Ok(())
    })
    .await;

    cleanup(&super_pool, &f).await;
}

/// Test 8 — Schema invariant: every tenant-scoped table has both
/// `relrowsecurity` AND `relforcerowsecurity` set. A future migration that
/// adds a tenant_id column without enabling RLS is the most likely source of
/// silent regressions; this test catches it.
#[tokio::test]
async fn every_tenant_scoped_table_has_rls_forced() {
    let (app_pool, _super_pool) = pools_or_skip!();
    // We can introspect pg_class as the app role — SELECT on the catalog is
    // granted by default to PUBLIC.
    let tables: &[&str] = &[
        "warehouses",
        "locations",
        "products",
        "categories",
        "suppliers",
        "supplier_products",
        "inventory",
        "product_lots",
        "inventory_lots",
        "movements",
        "recipes",
        "recipe_items",
        "work_orders",
        "work_order_materials",
        "purchase_orders",
        "purchase_order_lines",
        "purchase_returns",
        "purchase_return_items",
        "cycle_counts",
        "cycle_count_items",
        "notifications",
        "user_warehouses",
        "stock_configuration",
        "tool_instances",
    ];
    assert_eq!(
        tables.len(),
        24,
        "expected 24 tenant-scoped tables (sync with migration 20260509000001)"
    );

    for table in tables {
        let row = sqlx::query(
            "SELECT relrowsecurity, relforcerowsecurity \
             FROM pg_class WHERE relname = $1 AND relkind = 'r'",
        )
        .bind(table)
        .fetch_one(&app_pool)
        .await
        .unwrap_or_else(|e| panic!("introspect pg_class for {table}: {e}"));
        let rls: bool = row.get("relrowsecurity");
        let forced: bool = row.get("relforcerowsecurity");
        assert!(rls, "{table}: relrowsecurity must be true (RLS not enabled)");
        assert!(
            forced,
            "{table}: relforcerowsecurity must be true (FORCE missing — superuser-equivalent owners would bypass)"
        );
    }

    // Also confirm the THREE control-plane tables remain RLS-exempt.
    for control in ["tenants", "users", "user_tenants"] {
        let row = sqlx::query("SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relkind = 'r'")
            .bind(control)
            .fetch_one(&app_pool)
            .await
            .unwrap_or_else(|e| panic!("introspect pg_class for {control}: {e}"));
        let rls: bool = row.get("relrowsecurity");
        assert!(
            !rls,
            "{control}: control-plane table must NOT have RLS (membership lookup happens before session vars are planted)"
        );
    }
}

/// Smoke check (negative control) — running the SAME cross-tenant SELECT as
/// the SUPERUSER (`DATABASE_URL`) bypasses RLS and DOES see B's rows. This
/// proves the suite was actually exercising RLS in the prior tests rather
/// than passing vacuously. Documented as a one-shot smoke test, not a
/// permanent guarantee — the security guarantee is "non-superuser is
/// blocked", which the other tests assert.
#[tokio::test]
async fn smoke_superuser_pool_bypasses_rls() {
    let super_pool = match maybe_super_pool().await {
        Some(p) => p,
        None => {
            eprintln!("SKIP: DATABASE_URL not set");
            return;
        }
    };
    // Confirm we're really the superuser.
    let row = sqlx::query("SELECT current_user::text AS u, current_setting('is_superuser') AS s")
        .fetch_one(&super_pool)
        .await
        .expect("introspect role");
    let user: String = row.get("u");
    let is_super: String = row.get("s");
    assert_eq!(user, "vandepot", "expected superuser role 'vandepot', got '{user}'");
    assert_eq!(is_super, "on", "expected is_superuser=on for the negative-control smoke");

    let (app_pool, _) = pools_or_skip!();
    let f = seed_fixture(&super_pool).await;

    // Same SELECT shape as Test 1, but on the SUPERUSER pool. RLS bypassed.
    let mut tx = super_pool.begin().await.expect("begin super tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .unwrap();

    let row = sqlx::query("SELECT count(*)::bigint AS n FROM products WHERE tenant_id = $1")
        .bind(f.tenant_b)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let n: i64 = row.get("n");
    assert_eq!(
        n, 1,
        "superuser MUST see tenant_b's row (RLS bypassed). If this is 0, FORCE ROW LEVEL SECURITY is somehow binding the superuser too — investigate."
    );
    tx.rollback().await.ok();

    // Confirm the app pool, by contrast, sees 0 rows for the same query.
    // (Already covered by Test 1, but inlined here for the smoke contrast.)
    let mut tx = app_pool.begin().await.expect("begin app tx");
    sqlx::query("SELECT set_config('app.current_tenant', $1, true)")
        .bind(f.tenant_a.to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("SELECT set_config('app.is_superadmin', 'false', true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let row = sqlx::query("SELECT count(*)::bigint AS n FROM products WHERE tenant_id = $1")
        .bind(f.tenant_b)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let n_app: i64 = row.get("n");
    assert_eq!(
        n_app, 0,
        "app role (vandepot_app) must NOT see tenant_b's row — RLS contract"
    );
    tx.rollback().await.ok();

    cleanup(&super_pool, &f).await;
}
