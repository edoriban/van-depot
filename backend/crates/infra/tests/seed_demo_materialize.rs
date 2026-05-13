//! One-shot materialization test for the extended demo seed.
//!
//! This file is NOT part of the normal regression suite — every test here is
//! `#[ignore]`d so `cargo test` does not run them. To materialize the
//! extended demo data into the live `acmev2` tenant, invoke explicitly:
//!
//! ```bash
//! cd backend
//! cargo test -p vandepot-infra --test seed_demo_materialize -- --ignored --nocapture
//! ```
//!
//! The test opens a transaction with `app.is_superadmin='true'` (the same
//! bypass the admin endpoint uses), runs `seed_demo_for_tenant`, prints the
//! returned `SeedSummary`, and commits. It is idempotent: a second run logs a
//! summary with zero counters and inserts nothing.

use std::env;

use sqlx::PgPool;
use uuid::Uuid;

use vandepot_infra::seed::seed_demo_for_tenant;

async fn maybe_pool() -> Option<PgPool> {
    let _ = dotenvy::from_path("../../.env");
    let _ = dotenvy::dotenv();
    let url = env::var("DATABASE_URL").ok()?;
    PgPool::connect(&url).await.ok()
}

#[tokio::test]
#[ignore = "manual: materializes demo seed against the live acmev2 tenant"]
async fn materialize_seed_demo_for_acmev2() {
    let Some(pool) = maybe_pool().await else {
        eprintln!("DATABASE_URL not set — skipping materialization");
        return;
    };

    // Look up acmev2 by slug rather than hard-coding the UUID — keeps the
    // test working across DB resets that re-issue tenant ids.
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM tenants WHERE slug = 'acmev2' AND deleted_at IS NULL",
    )
    .fetch_optional(&pool)
    .await
    .expect("query tenant");

    let tenant_id = row
        .expect("acmev2 tenant must exist — create it via the bootstrap flow")
        .0;

    eprintln!("Materializing demo seed for acmev2 (tenant_id={tenant_id}) …");

    let mut tx = pool.begin().await.expect("begin tx");
    sqlx::query("SET LOCAL app.is_superadmin = 'true'")
        .execute(&mut *tx)
        .await
        .expect("plant superadmin GUC");

    let summary = seed_demo_for_tenant(&mut *tx, tenant_id)
        .await
        .expect("seed_demo_for_tenant");

    tx.commit().await.expect("commit");

    eprintln!("SeedSummary: {summary:#?}");
}

#[tokio::test]
#[ignore = "manual: prints absolute counts for the acmev2 demo tenant"]
async fn verify_counts_for_acmev2() {
    let Some(pool) = maybe_pool().await else {
        return;
    };

    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM tenants WHERE slug = 'acmev2' AND deleted_at IS NULL",
    )
    .fetch_optional(&pool)
    .await
    .expect("query tenant");
    let tenant_id = row.expect("acmev2 must exist").0;

    let mut tx = pool.begin().await.expect("begin tx");
    sqlx::query("SET LOCAL app.is_superadmin = 'true'")
        .execute(&mut *tx)
        .await
        .expect("plant superadmin GUC");

    for table in [
        "warehouses",
        "locations",
        "categories",
        "suppliers",
        "products",
        "product_lots",
        "inventory_lots",
        "movements",
        "picking_lists",
        "picking_lines",
        "work_orders",
        "purchase_orders",
        "recipes",
        "cycle_counts",
        "notifications",
    ] {
        let sql = format!("SELECT COUNT(*) FROM {table} WHERE tenant_id = $1");
        let (count,): (i64,) = sqlx::query_as(&sql)
            .bind(tenant_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or((-1,));
        eprintln!("{table:>20}: {count}");
    }

    tx.commit().await.ok();
}
