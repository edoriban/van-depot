use std::collections::HashMap;

use anyhow::Result;
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use tracing::info;
use uuid::Uuid;

use vandepot_domain::error::DomainError;

use crate::auth::password::hash_password;

pub mod stock_config;
pub use stock_config::replicate_stock_config_for_tenant;

/// Validates a superadmin password against the security policy.
///
/// Rules (all must hold):
/// - length >= 16 ASCII characters
/// - at least one ASCII uppercase letter (`A-Z`)
/// - at least one ASCII lowercase letter (`a-z`)
/// - at least one ASCII digit (`0-9`)
///
/// Returns `Err(reason)` naming the FIRST rule that fails. Caller is expected
/// to surface the reason on stderr and exit non-zero — there is no silent
/// fallback (see `bootstrap_superadmin`).
pub fn validate_superadmin_password(pw: &str) -> Result<(), String> {
    if pw.len() < 16 {
        return Err("SUPERADMIN_PASSWORD must be at least 16 characters".to_string());
    }
    if !pw.chars().any(|c| c.is_ascii_uppercase()) {
        return Err("SUPERADMIN_PASSWORD must contain an uppercase letter".to_string());
    }
    if !pw.chars().any(|c| c.is_ascii_lowercase()) {
        return Err("SUPERADMIN_PASSWORD must contain a lowercase letter".to_string());
    }
    if !pw.chars().any(|c| c.is_ascii_digit()) {
        return Err("SUPERADMIN_PASSWORD must contain a digit".to_string());
    }
    Ok(())
}

/// Errors that abort the boot sequence with a non-zero exit code.
///
/// Each variant carries a human-readable reason that the bootstrap entrypoint
/// emits to stderr verbatim before exiting. We keep it as `String` because
/// the only consumer is the boot path — no programmatic recovery is possible
/// for any of these conditions.
#[derive(Debug)]
pub enum BootstrapError {
    /// `RUN_SEED_SUPERADMIN=true` but a required env var was missing or empty,
    /// the email was malformed, or the password failed `validate_superadmin_password`.
    InvalidConfig(String),
    /// Underlying database / hashing error encountered while upserting the row.
    Database(anyhow::Error),
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BootstrapError::InvalidConfig(msg) => write!(f, "{msg}"),
            BootstrapError::Database(e) => write!(f, "database error during superadmin bootstrap: {e}"),
        }
    }
}

impl std::error::Error for BootstrapError {}

/// Env-gated bootstrap entrypoint called from `main.rs`.
///
/// Behavior:
/// - `RUN_SEED_SUPERADMIN` unset or != "true" → skip silently (logs an info line).
/// - `RUN_SEED_SUPERADMIN=true` → require `SUPERADMIN_EMAIL` and
///   `SUPERADMIN_PASSWORD`. Validate email contains `@`. Validate password via
///   `validate_superadmin_password`. Any failure returns
///   `BootstrapError::InvalidConfig` — the caller must print to stderr and
///   `std::process::exit(1)`. No fallback values.
/// - Success: upsert the user with `is_superadmin=true` (A3 dropped the
///   global `users.role` column — superadmin identity is the boolean flag).
///   Idempotent: re-running with a rotated password updates `password_hash`.
pub async fn bootstrap_superadmin(pool: &PgPool) -> Result<(), BootstrapError> {
    let run_flag = std::env::var("RUN_SEED_SUPERADMIN").unwrap_or_default();
    if run_flag != "true" {
        info!("Superadmin seed skipped (RUN_SEED_SUPERADMIN not enabled)");
        return Ok(());
    }

    let email = std::env::var("SUPERADMIN_EMAIL")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            BootstrapError::InvalidConfig(
                "RUN_SEED_SUPERADMIN=true but SUPERADMIN_EMAIL is not set".to_string(),
            )
        })?;

    if !email.contains('@') {
        return Err(BootstrapError::InvalidConfig(format!(
            "SUPERADMIN_EMAIL is malformed (missing '@'): {email}"
        )));
    }

    let password = std::env::var("SUPERADMIN_PASSWORD")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            BootstrapError::InvalidConfig(
                "RUN_SEED_SUPERADMIN=true but SUPERADMIN_PASSWORD is not set".to_string(),
            )
        })?;

    validate_superadmin_password(&password).map_err(BootstrapError::InvalidConfig)?;

    seed_superadmin(pool, &email, &password)
        .await
        .map_err(BootstrapError::Database)?;

    Ok(())
}

/// Env-gated dev-only default tenant bootstrap.
///
/// Behavior:
/// - `RUN_SEED_DEFAULT_TENANT` unset or != "true" → skip silently.
/// - `RUN_SEED_DEFAULT_TENANT=true` → idempotently UPSERT a single tenant row
///   (slug `dev`, name `Default Tenant`). If a tenant with that slug already
///   exists (any status), the call is a no-op and returns its id.
///
/// Why slug `dev` and NOT `default`:
/// The user-locked decision called for slug `default`, but migration
/// `20260507000001_create_tenants.sql` codifies a reserved-slug CHECK that
/// REJECTS `'default'` (along with `admin`, `api`, `www`, `app`, `public`,
/// `system`, `health`, `auth`). The migration was authored under design §3.1
/// and is already applied; changing the reserved list is out of scope for
/// A20. We therefore use `dev` — a short, unreserved slug that conveys the
/// dev-only intent. README + .env.example call this out so the deviation is
/// visible.
///
/// Per the design, superadmins do NOT receive a `user_tenants` row — they are
/// the bypass identity (`is_superadmin = true`) and would violate the
/// "superadmin has zero memberships" invariant. This function therefore only
/// touches `tenants`.
pub async fn seed_default_tenant_for_dev(pool: &PgPool) -> Result<Option<Uuid>> {
    let run_flag = std::env::var("RUN_SEED_DEFAULT_TENANT").unwrap_or_default();
    if run_flag != "true" {
        info!("Default tenant seed skipped (RUN_SEED_DEFAULT_TENANT not enabled)");
        return Ok(None);
    }

    // Use a direct INSERT ... ON CONFLICT to bypass `tenant_repo::create`'s
    // application-level reserved-slug guard (the slug `dev` is NOT reserved,
    // but we want this seed to be self-contained and not depend on the repo's
    // reserved-slug policy ever changing). The DB still enforces all CHECKs.
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO tenants (slug, name) \
         VALUES ($1, $2) \
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name \
         RETURNING id",
    )
    .bind("dev")
    .bind("Default Tenant")
    .fetch_one(pool)
    .await?;

    info!("Default tenant seeded: slug=dev id={}", id);
    Ok(Some(id))
}

/// Upserts the superadmin user.
///
/// Caller is expected to have already validated `email` and `password` via
/// `bootstrap_superadmin`. Idempotent via `ON CONFLICT (email)`: rotating
/// `SUPERADMIN_PASSWORD` will refresh `password_hash` and `is_superadmin` on
/// the next boot.
///
/// A3: the legacy `users.role` column was dropped — superadmin identity now
/// lives entirely in the `is_superadmin` boolean.
pub async fn seed_superadmin(pool: &PgPool, email: &str, password: &str) -> Result<()> {
    let password_hash = hash_password(password)?;

    sqlx::query(
        "INSERT INTO users (email, password_hash, name, is_superadmin)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            is_superadmin = true",
    )
    .bind(email)
    .bind(&password_hash)
    .bind("Super Admin")
    .execute(pool)
    .await?;

    info!("Superadmin seeded: {}", email);
    Ok(())
}

// ── Per-tenant demo seed ─────────────────────────────────────────────────────
//
// Phase D: the demo seed is now per-tenant and triggered via
// `POST /admin/tenants/{id}/seed-demo`. The endpoint provides the per-request
// transaction (with `app.is_superadmin='true'` already planted on it by the
// admin tenant_tx middleware) so RLS doesn't block writes into tenant-scoped
// tables.
//
// Idempotent contract: every INSERT into a tenant-scoped table uses a natural
// key + `ON CONFLICT DO NOTHING RETURNING id` so re-running the endpoint on a
// already-seeded tenant returns a SeedSummary with all-zero counters (proof
// of idempotency).
//
// Tables WITHOUT a natural unique key (recipes, cycle_counts, locations) are
// guarded by an explicit pre-check (SELECT … LIMIT 1) before insert.

/// Aggregate counters for a single `seed_demo_for_tenant` invocation.
///
/// Each field counts rows actually inserted by THIS call (rows that already
/// existed under ON CONFLICT DO NOTHING are NOT counted). On a re-run against
/// a fully-seeded tenant, every counter is zero.
#[derive(Debug, Default, Clone, Serialize)]
pub struct SeedSummary {
    pub warehouses: usize,
    pub locations: usize,
    pub categories: usize,
    pub suppliers: usize,
    pub products: usize,
    pub recipes: usize,
    pub work_orders: usize,
    pub purchase_orders: usize,
    pub cycle_counts: usize,
    pub notifications: usize,
    pub demo_users: usize,
    pub memberships: usize,
    /// Demo lots inserted by `seed_demo_product_lots` (target: 8 with mixed
    /// `quality_status` / expiration dates). Zero on idempotent re-run.
    pub product_lots: usize,
    /// Demo movement-log rows inserted by `seed_demo_movements` (target: 20
    /// distributed across `entry`/`exit`/`transfer`/`adjustment`). Zero on
    /// idempotent re-run.
    pub movements: usize,
    /// Demo picking lists inserted by `seed_demo_picking_lists` (target: 3
    /// across statuses: draft, released, in_progress). Zero on idempotent
    /// re-run.
    pub picking_lists: usize,
}

/// Per-tenant demo seed.
///
/// Caller MUST provide a connection from a transaction with
/// `app.is_superadmin='true'` set (the admin tenant_tx middleware does this).
/// Otherwise RLS WITH CHECK rejects every INSERT into tenant-scoped tables.
///
/// Idempotent: ON CONFLICT DO NOTHING RETURNING id gives us a precise
/// "newly-inserted" count per natural key. Re-running the function returns a
/// `SeedSummary` with every counter at zero.
pub async fn seed_demo_for_tenant(
    conn: &mut PgConnection,
    tenant_id: Uuid,
) -> Result<SeedSummary, DomainError> {
    let mut summary = SeedSummary::default();

    // Resolve the superadmin id; we use it as `created_by` for everything the
    // demo seed creates. It always exists at boot via `bootstrap_superadmin`.
    let admin_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE is_superadmin = true LIMIT 1",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    let ctx = seed_core(conn, tenant_id, admin_id, &mut summary).await?;
    seed_purchase_orders(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_purchase_orders_extra(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_recipes(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_work_orders(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_work_orders_extra(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_cycle_counts(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_notifications(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_demo_users_and_memberships(conn, tenant_id, &mut summary).await?;
    // Diversity sub-seeds — depend on products/suppliers/warehouses/locations
    // already populated by `seed_core`. Order matters: lots feed FEFO lookups
    // and any future picking-list release flow; movements are pure log
    // entries and don't depend on lots.
    seed_demo_product_lots(conn, tenant_id, &ctx, &mut summary).await?;
    seed_demo_movements(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_demo_picking_lists(conn, tenant_id, admin_id, &ctx, &mut summary).await?;

    Ok(summary)
}

/// Map sqlx errors out of seed helpers into a DomainError. RLS WITH CHECK
/// violations surface as 42501 → DomainError::Forbidden via the standard
/// repo `map_sqlx_error` helper, but here the seed runs inside the admin
/// bypass tx so those should never fire — we keep a generic fallback.
fn map_seed_err(err: sqlx::Error) -> DomainError {
    crate::repositories::shared::map_sqlx_error(err)
}

/// Resolved IDs for entities created (or already present) by `seed_core`.
/// Downstream sub-seeds look up cross-references through this map by stable
/// natural key (slug-style for warehouses, SKU for products, etc.).
struct SeedContext {
    warehouses: HashMap<&'static str, Uuid>,
    locations: HashMap<&'static str, Uuid>,
    categories: HashMap<&'static str, Uuid>,
    suppliers: HashMap<&'static str, Uuid>,
    products: HashMap<&'static str, Uuid>,
}

impl SeedContext {
    fn new() -> Self {
        Self {
            warehouses: HashMap::new(),
            locations: HashMap::new(),
            categories: HashMap::new(),
            suppliers: HashMap::new(),
            products: HashMap::new(),
        }
    }
}

/// Returns the existing id for `(tenant_id, name)` warehouse, or None.
async fn lookup_warehouse(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
) -> Result<Option<Uuid>, DomainError> {
    sqlx::query_scalar(
        "SELECT id FROM warehouses WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)
}

/// Returns the existing id for `(tenant_id, warehouse_id, name)` location.
async fn lookup_location(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    warehouse_id: Uuid,
    name: &str,
) -> Result<Option<Uuid>, DomainError> {
    sqlx::query_scalar(
        "SELECT id FROM locations \
         WHERE tenant_id = $1 AND warehouse_id = $2 AND name = $3",
    )
    .bind(tenant_id)
    .bind(warehouse_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)
}

/// Returns the existing id for `(tenant_id, name)` category.
async fn lookup_category(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
) -> Result<Option<Uuid>, DomainError> {
    sqlx::query_scalar(
        "SELECT id FROM categories WHERE tenant_id = $1 AND name = $2 AND parent_id IS NULL",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)
}

/// Returns the existing id for `(tenant_id, name)` supplier.
async fn lookup_supplier(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    name: &str,
) -> Result<Option<Uuid>, DomainError> {
    sqlx::query_scalar(
        "SELECT id FROM suppliers WHERE tenant_id = $1 AND name = $2",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)
}

/// Returns the existing id for `(tenant_id, sku)` product (excludes
/// soft-deleted). The natural key matches `products_tenant_sku_key`.
async fn lookup_product(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    sku: &str,
) -> Result<Option<Uuid>, DomainError> {
    sqlx::query_scalar(
        "SELECT id FROM products \
         WHERE tenant_id = $1 AND sku = $2 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .bind(sku)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)
}

// ── seed_core ────────────────────────────────────────────────────────────────
//
// Inserts the foundational catalog: 2 warehouses, ~12 locations across both,
// 5 categories, 4 suppliers, 15 products, plus inventory rows. Every INSERT
// is gated by ON CONFLICT or pre-check so a re-run is a no-op. Lookups
// populate the `SeedContext` with every id (newly inserted or pre-existing)
// for downstream sub-seeds.

const WAREHOUSES: &[(&str, &str, &str)] = &[
    ("ALM", "Almacén Principal", "Av. Industria #450, Col. Industrial, Monterrey, NL"),
    ("BOD", "Bodega Sur",        "Calle 5 de Mayo #120, Col. Centro, Monterrey, NL"),
];

/// Locations to insert per warehouse. Tuple shape:
///   (warehouse_key, location_key, name, location_type, parent_key_or_None,
///    pos_x, pos_y, width, height)
/// `parent_key_or_None` references another row in this same list (must come
/// later than the parent in the array). System-managed reception/finished_good
/// locations are added separately because of label/is_system specifics.
///
/// Positions target a 1200×800 canvas (see `frontend/src/components/warehouse/
/// map-canvas.tsx`). Layout decisions:
///   - Avoid the system locations' rectangles: reception/finished_good/
///     outbound sit at (0,0,100,100) and the Almacén work_center sits at
///     (600,400,180,160).
///   - Children (rack/shelf) are positioned INSIDE their parent zone with
///     ~10–20px of inner padding so map-canvas renders them nested.
///   - Almacén Principal lays out a left-to-right flow: materia prima →
///     corte/soldadura → producto terminado, with herramientas on the left
///     bottom row.
///   - Bodega Sur is a 4-zone storage layout.
#[allow(clippy::type_complexity)]
const LOCATIONS: &[(&str, &str, &str, &str, Option<&str>, f32, f32, f32, f32)] = &[
    // Almacén Principal — top-level zones
    ("ALM", "ZONA-MATERIA-PRIMA", "Zona de materia prima", "zone",       None,                       130.0,  60.0, 320.0, 230.0),
    ("ALM", "ZONA-CORTE",         "Zona de corte",         "zone",       None,                       470.0,  60.0, 280.0, 170.0),
    ("ALM", "ZONA-SOLDADURA",     "Zona de soldadura",     "zone",       None,                       470.0, 250.0, 270.0, 130.0),
    ("ALM", "PRODUCTO-TERMINADO", "Producto terminado",    "zone",       None,                       790.0,  60.0, 360.0, 320.0),
    ("ALM", "HERRAMIENTAS",       "Herramientas",          "zone",       None,                       130.0, 320.0, 320.0, 170.0),
    // Almacén Principal — children (positioned inside their parent zone)
    ("ALM", "RACK-A",             "Rack A - Tubería",      "rack",       Some("ZONA-MATERIA-PRIMA"), 150.0,  90.0, 140.0,  60.0),
    ("ALM", "RACK-B",             "Rack B - Perfiles",     "rack",       Some("ZONA-MATERIA-PRIMA"), 150.0, 170.0, 140.0,  60.0),
    ("ALM", "ESTANTE-1",          "Estante 1 - Puertas",   "shelf",      Some("PRODUCTO-TERMINADO"), 810.0, 100.0, 150.0,  60.0),
    ("ALM", "ESTANTE-2",          "Estante 2 - Ventanas",  "shelf",      Some("PRODUCTO-TERMINADO"), 810.0, 180.0, 150.0,  60.0),
    // Bodega Sur — top-level zones
    ("BOD", "BOD-GENERAL",        "Almacenamiento general","zone",       None,                       130.0,  60.0, 380.0, 300.0),
    ("BOD", "BOD-SOBRANTE",       "Material sobrante",     "zone",       None,                       550.0,  60.0, 320.0, 180.0),
    ("BOD", "BOD-EQUIPO",         "Equipo pesado",         "zone",       None,                       550.0, 280.0, 320.0, 250.0),
    ("BOD", "BOD-CONSUMIBLES",    "Consumibles",           "zone",       None,                       900.0,  60.0, 280.0, 250.0),
];

const CATEGORIES: &[(&str, &str)] = &[
    ("ACEROS", "Aceros y metales"),
    ("SOLD",   "Soldadura y consumibles"),
    ("HERR",   "Herramientas"),
    ("PINT",   "Pinturas y acabados"),
    ("TORN",   "Tornillería y herrajes"),
];

const SUPPLIERS: &[(&str, &str, &str, &str, &str)] = &[
    ("ACEROS-MTY",  "Aceros Monterrey SA",         "Juan García",     "818-555-0101", "ventas@acerosmonterrey.mx"),
    ("SOLD-NORTE",  "Soldaduras del Norte",        "María López",     "818-555-0202", "contacto@soldanorte.mx"),
    ("FERR-IND-MX", "Ferretería Industrial MX",    "Pedro Ramírez",   "818-555-0303", "pedidos@ferremx.mx"),
    ("PINT-REC",    "Pinturas y Recubrimientos SA","Ana Torres",      "818-555-0404", "ventas@pinturasyr.mx"),
];

/// Product seed data.
/// Tuple shape: (sku, name, category_key, unit_of_measure, min_stock,
///               max_stock, product_class, has_expiry).
#[allow(clippy::type_complexity)]
const PRODUCTS: &[(&str, &str, &str, &str, f64, f64, &str, bool)] = &[
    ("TUB-RED-2",  "Tubo redondo 2\"",              "ACEROS", "meter", 20.0, 100.0, "raw_material", false),
    ("TUB-CUA-1",  "Tubo cuadrado 1\"",             "ACEROS", "meter", 15.0, 80.0,  "raw_material", false),
    ("PTR-2X2",    "Perfil PTR 2x2",                "ACEROS", "meter", 10.0, 50.0,  "raw_material", false),
    ("ANG-1-18",   "Ángulo 1\"x1/8\"",              "ACEROS", "meter", 10.0, 40.0,  "raw_material", false),
    ("LAM-C14",    "Lámina cal 14",                 "ACEROS", "piece", 5.0,  20.0,  "raw_material", false),
    ("SOL-1-14",   "Solera 1\"x1/4\"",              "ACEROS", "meter", 10.0, 50.0,  "raw_material", false),
    ("ELE-6013",   "Electrodo 6013",                "SOLD",   "kg",    5.0,  25.0,  "raw_material", false),
    ("ELE-7018",   "Electrodo 7018",                "SOLD",   "kg",    3.0,  15.0,  "raw_material", false),
    ("GAS-ARG",    "Gas argón tanque",              "SOLD",   "piece", 1.0,  3.0,   "consumable",   false),
    ("DIS-COR-7",  "Disco de corte 7\"",            "HERR",   "piece", 10.0, 50.0,  "tool_spare",   false),
    ("DIS-DES-7",  "Disco de desbaste 7\"",         "HERR",   "piece", 5.0,  30.0,  "tool_spare",   false),
    ("PIN-ANT-R",  "Pintura anticorrosiva roja",    "PINT",   "liter", 4.0,  20.0,  "consumable",   true),
    ("THI-STD",    "Thinner",                       "PINT",   "liter", 5.0,  25.0,  "consumable",   true),
    ("TOR-14-1",   "Tornillo 1/4\"x1\"",            "TORN",   "piece", 100.0,500.0, "raw_material", false),
    ("BIS-IND-4",  "Bisagra industrial 4\"",        "TORN",   "piece", 20.0, 100.0, "raw_material", false),
];

async fn seed_core(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    summary: &mut SeedSummary,
) -> Result<SeedContext, DomainError> {
    let mut ctx = SeedContext::new();

    // ── Warehouses ───────────────────────────────────────────────────
    // Natural key: (tenant_id, name) via the partial unique INDEX
    // `warehouses_tenant_name_key WHERE deleted_at IS NULL`. Postgres
    // requires `ON CONFLICT (cols) WHERE pred DO NOTHING` (NOT
    // `ON CONFLICT ON CONSTRAINT`) for partial unique indexes.
    for (key, name, address) in WAREHOUSES {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO warehouses (tenant_id, name, address) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(name)
        .bind(address)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match inserted {
            Some(id) => {
                summary.warehouses += 1;
                id
            }
            None => lookup_warehouse(conn, tenant_id, name).await?
                .ok_or_else(|| DomainError::Internal(format!("warehouse '{name}' lookup failed after ON CONFLICT")))?,
        };
        ctx.warehouses.insert(*key, id);
    }

    // ── Locations: parent zones first, then children ─────────────────
    // Note: parent_id has no UNIQUE on (tenant_id, warehouse_id, name);
    // we pre-check (lookup_location) before insert. INSERTs without
    // ON CONFLICT — if pre-check missed (concurrent insert) the NOT NULL
    // / FK constraints surface, which is fine.
    //
    // pos_x/pos_y/width/height feed the warehouse map canvas. Pre-existing
    // rows are NOT repositioned here — the lookup short-circuits before the
    // INSERT, preserving any operator-edited layout. For repositioning an
    // already-seeded tenant, run a targeted UPDATE separately.
    for (wh_key, loc_key, name, ltype, parent_key, pos_x, pos_y, width, height) in LOCATIONS {
        let warehouse_id = ctx.warehouses[wh_key];

        if let Some(existing) = lookup_location(conn, tenant_id, warehouse_id, name).await? {
            ctx.locations.insert(*loc_key, existing);
            continue;
        }

        let parent_id: Option<Uuid> = match parent_key {
            Some(pk) => Some(ctx.locations[pk]),
            None => None,
        };

        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO locations \
                 (tenant_id, warehouse_id, parent_id, location_type, name, \
                  pos_x, pos_y, width, height) \
             VALUES ($1, $2, $3, $4::location_type, $5, $6, $7, $8, $9) \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .bind(parent_id)
        .bind(ltype)
        .bind(name)
        .bind(*pos_x)
        .bind(*pos_y)
        .bind(*width)
        .bind(*height)
        .fetch_one(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        summary.locations += 1;
        ctx.locations.insert(*loc_key, id);
    }

    // Reception locations (one per warehouse). System-managed, label='RCP'.
    for (wh_key, name) in [("ALM", "Recepción"), ("BOD", "Recepción")] {
        let warehouse_id = ctx.warehouses[wh_key];

        // The reception-per-warehouse partial unique
        // (`idx_one_reception_per_warehouse`) ensures at most one row.
        // Pre-check matches the `lookup_location` natural-key shape but the
        // reception location uses location_type='reception' as a discriminator.
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 \
               AND location_type = 'reception' AND is_system = TRUE",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match existing {
            Some(id) => id,
            None => {
                let id: Uuid = sqlx::query_scalar(
                    "INSERT INTO locations \
                         (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
                     VALUES ($1, $2, 'reception', $3, 'RCP', TRUE, 0, 0, 100, 100) \
                     RETURNING id",
                )
                .bind(tenant_id)
                .bind(warehouse_id)
                .bind(name)
                .fetch_one(&mut *conn)
                .await
                .map_err(map_seed_err)?;
                summary.locations += 1;
                id
            }
        };
        ctx.locations.insert(if wh_key == "ALM" { "RCP-ALM" } else { "RCP-BOD" }, id);
    }

    // Finished-good system location for Almacén Principal (work-orders
    // demo expects it). Backfilled by migration 20260423000003 for legacy
    // data; for a freshly-seeded tenant we add it here.
    {
        let warehouse_id = ctx.warehouses["ALM"];
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 \
               AND location_type = 'finished_good' AND is_system = TRUE",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match existing {
            Some(id) => id,
            None => {
                let id: Uuid = sqlx::query_scalar(
                    "INSERT INTO locations \
                         (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
                     VALUES ($1, $2, 'finished_good', 'Producto Terminado FG', 'PT', TRUE, 0, 0, 100, 100) \
                     RETURNING id",
                )
                .bind(tenant_id)
                .bind(warehouse_id)
                .fetch_one(&mut *conn)
                .await
                .map_err(map_seed_err)?;
                summary.locations += 1;
                id
            }
        };
        ctx.locations.insert("FG-ALM", id);
    }

    // Work-center system location for Almacén Principal (work_orders
    // expect it; CHECK requires is_system=true).
    {
        let warehouse_id = ctx.warehouses["ALM"];
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM locations \
             WHERE tenant_id = $1 AND warehouse_id = $2 \
               AND location_type = 'work_center' AND name = 'Taller Principal'",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match existing {
            Some(id) => id,
            None => {
                let id: Uuid = sqlx::query_scalar(
                    "INSERT INTO locations \
                         (tenant_id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height) \
                     VALUES ($1, $2, 'work_center', 'Taller Principal', 'T1', TRUE, 600, 400, 180, 160) \
                     RETURNING id",
                )
                .bind(tenant_id)
                .bind(warehouse_id)
                .fetch_one(&mut *conn)
                .await
                .map_err(map_seed_err)?;
                summary.locations += 1;
                id
            }
        };
        ctx.locations.insert("WC-ALM", id);
    }

    // ── Categories ───────────────────────────────────────────────────
    // Natural key: (tenant_id, parent_id, name) UNIQUE NULLS NOT DISTINCT
    // (top-level cats have parent_id IS NULL — NNDD treats NULL=NULL).
    for (key, name) in CATEGORIES {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO categories (tenant_id, name, parent_id) \
             VALUES ($1, $2, NULL) \
             ON CONFLICT (tenant_id, parent_id, name) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(name)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match inserted {
            Some(id) => {
                summary.categories += 1;
                id
            }
            None => lookup_category(conn, tenant_id, name).await?
                .ok_or_else(|| DomainError::Internal(format!("category '{name}' lookup failed")))?,
        };
        ctx.categories.insert(*key, id);
    }

    // ── Suppliers ────────────────────────────────────────────────────
    // Natural key: (tenant_id, name) UNIQUE NULLS NOT DISTINCT.
    for (key, name, contact, phone, email) in SUPPLIERS {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO suppliers (tenant_id, name, contact_name, phone, email) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (tenant_id, name) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(name)
        .bind(contact)
        .bind(phone)
        .bind(email)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match inserted {
            Some(id) => {
                summary.suppliers += 1;
                id
            }
            None => lookup_supplier(conn, tenant_id, name).await?
                .ok_or_else(|| DomainError::Internal(format!("supplier '{name}' lookup failed")))?,
        };
        ctx.suppliers.insert(*key, id);
    }

    // ── Products ─────────────────────────────────────────────────────
    // Natural key: (tenant_id, sku) UNIQUE WHERE deleted_at IS NULL
    // (partial). ON CONFLICT DO NOTHING relies on the named index.
    for (sku, name, cat_key, uom, min_stock, max_stock, product_class, has_expiry) in PRODUCTS {
        let category_id = ctx.categories[cat_key];
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO products \
                 (tenant_id, name, sku, category_id, unit_of_measure, \
                  min_stock, max_stock, product_class, has_expiry, created_by) \
             VALUES ($1, $2, $3, $4, $5::unit_type, $6, $7, $8::product_class, $9, $10) \
             ON CONFLICT (tenant_id, sku) WHERE deleted_at IS NULL DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(name)
        .bind(sku)
        .bind(category_id)
        .bind(uom)
        .bind(min_stock)
        .bind(max_stock)
        .bind(product_class)
        .bind(has_expiry)
        .bind(admin_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match inserted {
            Some(id) => {
                summary.products += 1;
                id
            }
            None => lookup_product(conn, tenant_id, sku).await?
                .ok_or_else(|| DomainError::Internal(format!("product '{sku}' lookup failed")))?,
        };
        ctx.products.insert(*sku, id);
    }

    // Manufacturable raw_material (used by work_orders demo).
    // Goes through the same code path; counted under `products`.
    {
        let category_id = ctx.categories["ACEROS"];
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO products \
                 (tenant_id, name, sku, category_id, unit_of_measure, \
                  min_stock, max_stock, product_class, has_expiry, is_manufactured, created_by) \
             VALUES ($1, 'Puerta herrería básica', 'PUE-HER-BAS', $2, 'piece'::unit_type, \
                     0, 50, 'raw_material'::product_class, FALSE, TRUE, $3) \
             ON CONFLICT (tenant_id, sku) WHERE deleted_at IS NULL DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(category_id)
        .bind(admin_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let id = match inserted {
            Some(id) => {
                summary.products += 1;
                id
            }
            None => lookup_product(conn, tenant_id, "PUE-HER-BAS").await?
                .ok_or_else(|| DomainError::Internal("PUE-HER-BAS lookup failed".to_string()))?,
        };
        ctx.products.insert("PUE-HER-BAS", id);
    }

    // ── Inventory rows (idempotent — ON CONFLICT DO NOTHING) ─────────
    // Natural key: (tenant_id, product_id, location_id) inferred from the
    // existing `(product_id, location_id)` UNIQUE on inventory; the
    // composite FKs guarantee tenant agreement so we can rely on the
    // pre-existing constraint name.
    let inv_rows: &[(&str, &str, f64)] = &[
        ("TUB-RED-2",  "RACK-A",         45.0),
        ("TUB-CUA-1",  "RACK-A",         30.0),
        ("PTR-2X2",    "RACK-A",         25.0),
        ("ANG-1-18",   "RACK-B",         35.0),
        ("LAM-C14",    "RACK-B",         12.0),
        ("SOL-1-14",   "RACK-B",         28.0),
        ("ELE-6013",   "ZONA-SOLDADURA", 16.0),
        ("ELE-7018",   "ZONA-SOLDADURA", 8.0),
        ("GAS-ARG",    "ZONA-SOLDADURA", 3.0),
        ("DIS-COR-7",  "HERRAMIENTAS",   25.0),
        ("DIS-DES-7",  "HERRAMIENTAS",   15.0),
        ("PIN-ANT-R",  "BOD-GENERAL",    14.0),
        ("THI-STD",    "BOD-GENERAL",    25.0),
        ("TOR-14-1",   "BOD-GENERAL",    200.0),
        ("BIS-IND-4",  "BOD-GENERAL",    45.0),
    ];

    for (sku, loc_key, qty) in inv_rows {
        let product_id = ctx.products[*sku];
        let location_id = ctx.locations[*loc_key];
        sqlx::query(
            "INSERT INTO inventory (tenant_id, product_id, location_id, quantity) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (product_id, location_id) DO NOTHING",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(location_id)
        .bind(qty)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;
    }

    Ok(ctx)
}

// ── seed_purchase_orders ────────────────────────────────────────────────────
//
// One demo purchase order per tenant: OC-DEMO-001 ('sent' status, 2 lines).
// Natural key: (tenant_id, order_number).

async fn seed_purchase_orders(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let order_number = "OC-DEMO-001";

    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO purchase_orders \
             (tenant_id, supplier_id, order_number, status, total_amount, \
              expected_delivery_date, notes, created_by) \
         VALUES ($1, $2, $3, 'sent', 0, \
                 (CURRENT_DATE + INTERVAL '7 days')::date, \
                 'Pedido demo enviado a proveedor', $4) \
         ON CONFLICT (tenant_id, order_number) DO NOTHING \
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(ctx.suppliers["ACEROS-MTY"])
    .bind(order_number)
    .bind(admin_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    let Some(po_id) = inserted else {
        // Already seeded for this tenant — nothing further to do.
        return Ok(());
    };
    summary.purchase_orders += 1;

    // Lines (no per-line natural key beyond purchase_order_id+product_id;
    // the parent ON CONFLICT short-circuits us above so we know we just
    // inserted the parent fresh and the lines are guaranteed-new).
    sqlx::query(
        "INSERT INTO purchase_order_lines \
             (tenant_id, purchase_order_id, product_id, quantity_ordered, \
              quantity_received, unit_price, notes) \
         VALUES \
             ($1, $2, $3, 80, 0, 180.00, 'Tubo redondo 2 pulgadas'), \
             ($1, $2, $4, 20, 0, 220.00, 'Electrodos 6013')",
    )
    .bind(tenant_id)
    .bind(po_id)
    .bind(ctx.products["TUB-RED-2"])
    .bind(ctx.products["ELE-6013"])
    .execute(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    // Update header total.
    sqlx::query(
        "UPDATE purchase_orders \
         SET total_amount = ( \
             SELECT COALESCE(SUM(quantity_ordered * unit_price), 0) \
             FROM purchase_order_lines WHERE purchase_order_id = $1 \
         ) \
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(po_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    Ok(())
}

// ── seed_recipes ────────────────────────────────────────────────────────────
//
// Recipes have NO natural unique key in the schema. We pre-check by name:
// if a recipe with `(tenant_id, name)` exists (deleted_at IS NULL) we skip.

async fn seed_recipes(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let recipe_name = "Puerta herrería básica";

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM recipes \
         WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL \
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(recipe_name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    if existing.is_some() {
        return Ok(());
    }

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO recipes (tenant_id, name, description, created_by, is_active) \
         VALUES ($1, $2, 'Receta base de puerta de herrería estándar', $3, TRUE) \
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(recipe_name)
    .bind(admin_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_seed_err)?;
    summary.recipes += 1;

    // Items — natural key (recipe_id, product_id) UNIQUE preserved post-B5.
    let items: &[(&str, f64, &str)] = &[
        ("TUB-RED-2", 6.0, "Marco perimetral"),
        ("TUB-CUA-1", 4.0, "Refuerzos internos"),
        ("SOL-1-14",  2.0, "Refuerzo de bisagras"),
        ("BIS-IND-4", 2.0, "Bisagras"),
        ("ELE-6013",  0.5, "Electrodos"),
        ("PIN-ANT-R", 0.25, "Acabado anticorrosivo"),
    ];
    for (sku, qty, notes) in items {
        sqlx::query(
            "INSERT INTO recipe_items (tenant_id, recipe_id, product_id, quantity, notes) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (recipe_id, product_id) DO NOTHING",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(ctx.products[*sku])
        .bind(qty)
        .bind(notes)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;
    }
    Ok(())
}

// ── seed_work_orders ────────────────────────────────────────────────────────
//
// Two demo work orders: WO-DEMO-01 (draft) and WO-DEMO-02 (completed).
// Natural key: (tenant_id, code) UNIQUE.

async fn seed_work_orders(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    // Look up the demo recipe id (created in seed_recipes).
    let recipe_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM recipes \
         WHERE tenant_id = $1 AND name = 'Puerta herrería básica' AND deleted_at IS NULL \
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    let Some(recipe_id) = recipe_id else {
        // No recipe → no work-orders demo.
        return Ok(());
    };
    let warehouse_id = ctx.warehouses["ALM"];
    let work_center_id = ctx.locations["WC-ALM"];
    let fg_product_id = ctx.products["PUE-HER-BAS"];

    for code in ["WO-DEMO-01", "WO-DEMO-02"] {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO work_orders \
                 (tenant_id, code, recipe_id, fg_product_id, fg_quantity, status, \
                  warehouse_id, work_center_location_id, notes, created_by) \
             VALUES ($1, $2, $3, $4, 1, 'draft', $5, $6, 'Demo work order', $7) \
             ON CONFLICT (tenant_id, code) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(code)
        .bind(recipe_id)
        .bind(fg_product_id)
        .bind(warehouse_id)
        .bind(work_center_id)
        .bind(admin_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        if let Some(wo_id) = inserted {
            summary.work_orders += 1;

            // Snapshot recipe materials onto the work order.
            // (recipe_items already exist for the demo recipe.)
            sqlx::query(
                "INSERT INTO work_order_materials \
                     (tenant_id, work_order_id, product_id, quantity_expected, quantity_consumed) \
                 SELECT $1, $2, ri.product_id, ri.quantity, 0 \
                 FROM recipe_items ri \
                 WHERE ri.recipe_id = $3 \
                 ON CONFLICT (work_order_id, product_id) DO NOTHING",
            )
            .bind(tenant_id)
            .bind(wo_id)
            .bind(recipe_id)
            .execute(&mut *conn)
            .await
            .map_err(map_seed_err)?;
        }
    }

    Ok(())
}

// ── seed_cycle_counts ───────────────────────────────────────────────────────
//
// One demo cycle count. Cycle counts have no natural unique key — pre-check
// by `(tenant_id, name)`.

async fn seed_cycle_counts(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let name = "CC-DEMO Almacén Principal";

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM cycle_counts \
         WHERE tenant_id = $1 AND name = $2 \
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    if existing.is_some() {
        return Ok(());
    }

    let cc_id: Uuid = sqlx::query_scalar(
        "INSERT INTO cycle_counts \
             (tenant_id, warehouse_id, name, status, created_by, notes) \
         VALUES ($1, $2, $3, 'in_progress', $4, 'Conteo demo') \
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(ctx.warehouses["ALM"])
    .bind(name)
    .bind(admin_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_seed_err)?;
    summary.cycle_counts += 1;

    // 2 items — UNIQUE (cycle_count_id, product_id, location_id).
    sqlx::query(
        "INSERT INTO cycle_count_items \
             (tenant_id, cycle_count_id, product_id, location_id, system_quantity) \
         VALUES ($1, $2, $3, $4, 45), \
                ($1, $2, $5, $4, 30) \
         ON CONFLICT (cycle_count_id, product_id, location_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(cc_id)
    .bind(ctx.products["TUB-RED-2"])
    .bind(ctx.locations["RACK-A"])
    .bind(ctx.products["TUB-CUA-1"])
    .execute(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    Ok(())
}

// ── seed_notifications ──────────────────────────────────────────────────────
//
// 1 demo notification per tenant addressed to the superadmin.
// Natural key: partial unique index `idx_notifications_dedup` on
// (user_id, dedup_key) WHERE dedup_key IS NOT NULL. Use a tenant-prefixed
// dedup_key so superadmin's notifications don't collide across tenants.

async fn seed_notifications(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    _ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let dedup_key = format!("seed-demo-welcome-{tenant_id}");

    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO notifications \
             (tenant_id, user_id, notification_type, title, body, dedup_key) \
         VALUES ($1, $2, 'system', 'Datos demo cargados', \
                 'El tenant fue inicializado con datos demo.', $3) \
         ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING \
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(admin_id)
    .bind(&dedup_key)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    if inserted.is_some() {
        summary.notifications += 1;
    }
    Ok(())
}

// ── seed_demo_users_and_memberships ─────────────────────────────────────────
//
// Inserts 3 demo users (edgar, luis, laura — global, no tenant_id on
// `users`) and grants each a tenant membership in the target tenant.
// Idempotent via ON CONFLICT (email) on users and ON CONFLICT (user_id,
// tenant_id) on user_tenants.
//
// Roles per user-locked decision:
//   edgar@vandev.mx → owner
//   luis@vandev.mx  → manager
//   laura@vandev.mx → operator

async fn seed_demo_users_and_memberships(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let demo_hash = hash_password("demo123")
        .map_err(|e| DomainError::Internal(format!("hash demo password: {e}")))?;

    let demo_users: &[(&str, &str, &str)] = &[
        ("edgar@vandev.mx", "Edgar Martínez", "owner"),
        ("luis@vandev.mx",  "Luis Mendoza",   "manager"),
        ("laura@vandev.mx", "Laura Díaz",     "operator"),
    ];

    for (email, name, role) in demo_users {
        // Insert user globally (no tenant_id on users). ON CONFLICT (email)
        // makes re-runs a no-op.
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (email) DO NOTHING \
             RETURNING id",
        )
        .bind(email)
        .bind(&demo_hash)
        .bind(name)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let user_id = match inserted {
            Some(id) => {
                summary.demo_users += 1;
                id
            }
            None => sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM users WHERE email = $1",
            )
            .bind(email)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_seed_err)?,
        };

        // Membership. user_tenants PK is (user_id, tenant_id).
        let membership_inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO user_tenants (user_id, tenant_id, role) \
             VALUES ($1, $2, $3::tenant_role) \
             ON CONFLICT (user_id, tenant_id) DO NOTHING \
             RETURNING user_id",
        )
        .bind(user_id)
        .bind(tenant_id)
        .bind(role)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        if membership_inserted.is_some() {
            summary.memberships += 1;
        }

        // Warehouse grants. `/warehouses` list handler filters non-superadmin
        // callers by `user_warehouses` (api/src/routes/warehouses.rs:165-179),
        // so an owner/manager/operator with zero rows here sees zero
        // warehouses even though their `user_tenants` membership is valid.
        // Grant every demo user access to every warehouse in this tenant so
        // the demo isn't broken by the access-control filter.
        sqlx::query(
            "INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id) \
             SELECT $1, $2, id FROM warehouses WHERE tenant_id = $1 \
             ON CONFLICT DO NOTHING",
        )
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;
    }

    Ok(())
}

// ── seed_demo_product_lots ──────────────────────────────────────────────────
//
// Inserts 8 demo lots across raw_material + expirable consumable products
// already created by `seed_core`. The mix exercises every `QualityStatus`
// variant (pending, approved, rejected, quarantine) plus expiration
// scenarios (one expired, two near-expiry, two long-shelf, three undated)
// so the `/lotes` UI and quality dashboards have meaningful rows out of
// the box.
//
// Idempotency: natural key is `(product_id, lot_number)` UNIQUE on
// `product_lots`. `ON CONFLICT (product_id, lot_number) DO NOTHING
// RETURNING id` short-circuits on a re-run and the `if let Some(_)` arm
// also seeds the matching `inventory_lots` row — guarded by its own
// `(product_lot_id, location_id)` UNIQUE.
//
// Lots are placed at the warehouse's reception location (RCP-*) for
// `pending`/`quarantine`/`rejected` (mirrors the receiving flow) and at
// the standard storage location (RACK-A/B, ZONA-SOLDADURA, BOD-GENERAL)
// for `approved` lots — matches what an operator would see after a Q&A
// pass-through.
//
// Quantities are intentionally small (5..25) so they don't visually
// dominate the inventory totals seeded in `seed_core`. We do NOT touch
// the aggregated `inventory` table here — the `inventory_lots` join is
// the source of truth for lot-level views (`/lotes/[id]`), and the
// existing `seed_core` inventory rows already drive the catalog/dashboard.

async fn seed_demo_product_lots(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    // (sku, lot_number, quality_status, batch_offset_days, expiration_offset_days, qty, location_key, notes)
    //   * batch_offset_days:      NEGATIVE = days before today; None = NULL batch_date.
    //   * expiration_offset_days: NEGATIVE = expired; POSITIVE = future; None = NULL (non-perishable).
    //
    // Curated set (8 lots):
    //   1. TUB-RED-2  approved, 90 days old, no expiry      → healthy raw stock at RACK-A
    //   2. TUB-CUA-1  approved, 60 days old, no expiry      → healthy raw stock at RACK-A
    //   3. PIN-ANT-R  approved, fresh, 180 days to expire   → healthy consumable at BOD-GENERAL
    //   4. PIN-ANT-R  pending,  10 days old, 7 days to exp  → NEAR-EXPIRY pending at RCP-ALM
    //   5. THI-STD    quarantine, 30 days old, 30 days to exp → quality hold at RCP-BOD
    //   6. THI-STD    rejected,  90 days old, 5 days expired → EXPIRED reject at RCP-BOD
    //   7. ELE-6013   approved, 5 days old, no expiry       → fresh stock at ZONA-SOLDADURA
    //   8. ELE-7018   pending,  2 days old, no expiry       → newly received pending at RCP-ALM
    let lot_rows: &[(&str, &str, &str, Option<i32>, Option<i32>, f64, &str, &str)] = &[
        ("TUB-RED-2", "LOT-TUB-2026-001", "approved",   Some(-90), None,       25.0, "RACK-A",         "Lote demo aprobado — stock vigente"),
        ("TUB-CUA-1", "LOT-TUB-2026-002", "approved",   Some(-60), None,       18.0, "RACK-A",         "Lote demo aprobado — stock vigente"),
        ("PIN-ANT-R", "LOT-PIN-2026-001", "approved",   Some(-5),  Some(180),  12.0, "BOD-GENERAL",    "Lote demo aprobado — pintura vigente"),
        ("PIN-ANT-R", "LOT-PIN-2026-002", "pending",    Some(-10), Some(7),    8.0,  "RCP-ALM",        "Lote demo en QA — próximo a vencer"),
        ("THI-STD",   "LOT-THI-2026-001", "quarantine", Some(-30), Some(30),   10.0, "RCP-BOD",        "Lote demo en cuarentena — pendiente decisión"),
        ("THI-STD",   "LOT-THI-2026-002", "rejected",   Some(-90), Some(-5),   6.0,  "RCP-BOD",        "Lote demo rechazado — vencido"),
        ("ELE-6013",  "LOT-ELE-2026-001", "approved",   Some(-5),  None,       15.0, "ZONA-SOLDADURA", "Lote demo aprobado — electrodos frescos"),
        ("ELE-7018",  "LOT-ELE-2026-002", "pending",    Some(-2),  None,       5.0,  "RCP-ALM",        "Lote demo en QA — recién recibido"),
    ];

    for (sku, lot_number, quality, batch_off, exp_off, qty, loc_key, notes) in lot_rows {
        let product_id = match ctx.products.get(*sku) {
            Some(id) => *id,
            // Missing product means `seed_core` was customized and this SKU
            // was dropped. Skip gracefully rather than panic — keeps the seed
            // robust under future catalog tweaks.
            None => continue,
        };
        let location_id = match ctx.locations.get(*loc_key) {
            Some(id) => *id,
            None => continue,
        };
        let supplier_id = ctx.suppliers.get("ACEROS-MTY").copied();

        // INSERT lot with ON CONFLICT on `(product_id, lot_number)` UNIQUE.
        // Note: `product_lots` has only a 2-column UNIQUE — there is no
        // `tenant_id` in the key. Cross-tenant lot numbers can collide; we
        // rely on the lot_number prefix (LOT-*-YYYY-NNN) being demo-only.
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO product_lots \
                 (tenant_id, product_id, lot_number, batch_date, expiration_date, \
                  supplier_id, received_quantity, quality_status, notes) \
             VALUES ($1, $2, $3, \
                     CASE WHEN $4::int IS NULL THEN NULL \
                          ELSE (CURRENT_DATE + ($4::int || ' days')::interval)::date END, \
                     CASE WHEN $5::int IS NULL THEN NULL \
                          ELSE (CURRENT_DATE + ($5::int || ' days')::interval)::date END, \
                     $6, $7, $8::quality_status, $9) \
             ON CONFLICT (product_id, lot_number) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(lot_number)
        .bind(batch_off)
        .bind(exp_off)
        .bind(supplier_id)
        .bind(qty)
        .bind(quality)
        .bind(notes)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let Some(lot_id) = inserted else {
            // Lot already exists for this product+lot_number — skip the
            // inventory_lots write too (idempotent re-run).
            continue;
        };
        summary.product_lots += 1;

        // Companion `inventory_lots` row so the lot has visible stock at
        // its location (the /lotes/[id] page computes total via this join).
        // For rejected lots we still seed the inventory row — the UI shows
        // "rejected stock awaiting return" which matches the operational
        // reality of a real reject.
        sqlx::query(
            "INSERT INTO inventory_lots (tenant_id, product_lot_id, location_id, quantity) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (product_lot_id, location_id) DO NOTHING",
        )
        .bind(tenant_id)
        .bind(lot_id)
        .bind(location_id)
        .bind(qty)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;
    }

    Ok(())
}

// ── seed_demo_movements ─────────────────────────────────────────────────────
//
// Inserts 20 demo movement log rows distributed across `entry` (8),
// `exit` (6), `transfer` (4), `adjustment` (2). Movements are an
// IMMUTABLE log table (no triggers, no `updated_at`) so we can stamp
// historical rows without touching `inventory` levels — they exist
// purely to populate `/movimientos` with a believable timeline.
//
// Idempotency: `movements` has no natural unique key. We probe for
// existing demo rows via `reference` LIKE 'MOV-DEMO-%' before inserting.
// Re-runs short-circuit with a counter of 0.
//
// Timestamps span the last 14 days so the chart-friendly date filters
// in `/movimientos` have data to chart over.

async fn seed_demo_movements(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    // Idempotency probe — if ANY MOV-DEMO-* row exists for this tenant,
    // assume the full set is already seeded.
    let already_seeded: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM movements \
         WHERE tenant_id = $1 AND reference LIKE 'MOV-DEMO-%' \
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    if already_seeded.is_some() {
        return Ok(());
    }

    // Tuple shape:
    //   (movement_type, product_sku, from_loc_key, to_loc_key, qty, days_ago, reference_suffix, notes, with_supplier)
    //   from_loc_key/to_loc_key: Option<&str> — None = NULL (e.g. entry has
    //   no from, exit has no to).
    #[allow(clippy::type_complexity)]
    let movement_rows: &[(&str, &str, Option<&str>, Option<&str>, f64, i32, &str, &str, bool)] = &[
        // ── entries (8): supplier receptions arriving at warehouse zones ─────
        ("entry",      "TUB-RED-2",   None,                Some("RCP-ALM"),         50.0, 14, "001-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "ELE-6013",    None,                Some("RCP-ALM"),         15.0, 12, "002-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "PIN-ANT-R",   None,                Some("RCP-BOD"),         12.0, 10, "003-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "BIS-IND-4",   None,                Some("RCP-ALM"),         50.0, 9,  "004-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "TOR-14-1",    None,                Some("RCP-ALM"),        100.0, 8,  "005-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "ELE-7018",    None,                Some("RCP-ALM"),          5.0, 7,  "006-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "THI-STD",     None,                Some("RCP-BOD"),         10.0, 6,  "007-RCP", "Recepción demo de proveedor",          true),
        ("entry",      "PTR-2X2",     None,                Some("RCP-ALM"),         20.0, 5,  "008-RCP", "Recepción demo de proveedor",          true),
        // ── exits (6): consumption to work center / fulfillment ─────────────
        ("exit",       "TUB-RED-2",   Some("RACK-A"),      None,                     6.0, 11, "009-OUT", "Salida demo a producción",             false),
        ("exit",       "TUB-CUA-1",   Some("RACK-A"),      None,                     4.0, 10, "010-OUT", "Salida demo a producción",             false),
        ("exit",       "ELE-6013",    Some("ZONA-SOLDADURA"), None,                  2.0, 8,  "011-OUT", "Consumo demo en soldadura",            false),
        ("exit",       "BIS-IND-4",   Some("BOD-GENERAL"), None,                     4.0, 6,  "012-OUT", "Salida demo de bisagras",              false),
        ("exit",       "DIS-COR-7",   Some("HERRAMIENTAS"), None,                    3.0, 4,  "013-OUT", "Salida demo de discos de corte",       false),
        ("exit",       "PIN-ANT-R",   Some("BOD-GENERAL"), None,                     1.5, 2,  "014-OUT", "Salida demo de pintura",               false),
        // ── transfers (4): inter-zone moves ─────────────────────────────────
        ("transfer",   "TUB-RED-2",   Some("RCP-ALM"),     Some("RACK-A"),          20.0, 13, "015-TRN", "Traslado demo RCP→RACK-A",             false),
        ("transfer",   "ELE-6013",    Some("RCP-ALM"),     Some("ZONA-SOLDADURA"),  10.0, 11, "016-TRN", "Traslado demo RCP→Soldadura",          false),
        ("transfer",   "PIN-ANT-R",   Some("RCP-BOD"),     Some("BOD-GENERAL"),      8.0, 9,  "017-TRN", "Traslado demo RCP→Almacenamiento",     false),
        ("transfer",   "PTR-2X2",     Some("RCP-ALM"),     Some("RACK-A"),          15.0, 5,  "018-TRN", "Traslado demo RCP→RACK-A",             false),
        // ── adjustments (2): cycle-count corrections ────────────────────────
        ("adjustment", "TUB-CUA-1",   Some("RACK-A"),      Some("RACK-A"),           1.0, 3,  "019-ADJ", "Ajuste demo por conteo cíclico",       false),
        ("adjustment", "SOL-1-14",    Some("RACK-B"),      Some("RACK-B"),           2.0, 1,  "020-ADJ", "Ajuste demo por conteo cíclico",       false),
    ];

    for (mtype, sku, from_key, to_key, qty, days_ago, ref_suffix, notes, with_supplier) in movement_rows {
        let product_id = match ctx.products.get(*sku) {
            Some(id) => *id,
            None => continue,
        };
        let from_id: Option<Uuid> = from_key.and_then(|k| ctx.locations.get(k).copied());
        let to_id: Option<Uuid> = to_key.and_then(|k| ctx.locations.get(k).copied());
        let supplier_id: Option<Uuid> = if *with_supplier {
            ctx.suppliers.get("ACEROS-MTY").copied()
        } else {
            None
        };

        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO movements \
                 (tenant_id, product_id, from_location_id, to_location_id, quantity, \
                  movement_type, user_id, reference, notes, supplier_id, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6::movement_type, $7, $8, $9, $10, \
                     NOW() - ($11::int || ' days')::interval) \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(product_id)
        .bind(from_id)
        .bind(to_id)
        .bind(qty)
        .bind(mtype)
        .bind(admin_id)
        .bind(format!("MOV-DEMO-{ref_suffix}"))
        .bind(notes)
        .bind(supplier_id)
        .bind(days_ago)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        if inserted.is_some() {
            summary.movements += 1;
        }
    }

    Ok(())
}

// ── seed_demo_picking_lists ─────────────────────────────────────────────────
//
// Inserts 3 demo picking lists — one per status (`draft`, `released`,
// `in_progress`). Each list lives in `ALM` warehouse and references the
// most common products from `seed_core` so the `/picking-lists` index
// has variety out of the gate.
//
// Status notes:
//   * draft        → pure header + lines, no `released_at` / lot
//                    assignments. Safe to release through the API.
//   * released     → header + lines, `released_at` stamped, NO lot
//                    assignments and NO reservations. The Sem 3 release
//                    flow is too coupled to FEFO + reservations to
//                    replay in a seed cleanly; we settle for a
//                    "released-without-reservations" sentinel so the UI
//                    can show a non-draft status. Limitations:
//                       - `start` transition from this seed row will
//                         work (no reservation lookup),
//                       - re-running the API's release on this row
//                         would fail the transition guard (already
//                         released).
//   * in_progress  → released + assigned + started timestamps stamped;
//                    `assigned_to_user_id` set to the demo operator
//                    (`laura@vandev.mx`). Same caveats as released
//                    regarding reservations.
//
// We intentionally skip `completed` because it requires fully-picked
// lines + matching consumption movements + inventory decrement which
// would diverge inventory totals from what `seed_core` set up.
//
// Idempotency: natural key is `(tenant_id, picking_number)` UNIQUE.
// `ON CONFLICT DO NOTHING RETURNING id` short-circuits on a re-run; the
// `if let Some(_)` arm also seeds the children. Lines have no natural
// unique key but the parent header insert is the only path that creates
// them — when the parent INSERT short-circuits, the lines also skip.

async fn seed_demo_picking_lists(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    let warehouse_id = match ctx.warehouses.get("ALM") {
        Some(id) => *id,
        None => return Ok(()),
    };

    // Resolve the demo operator (`laura@vandev.mx`) for assignment.
    // Created earlier in `seed_demo_users_and_memberships`.
    let operator_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE email = 'laura@vandev.mx'",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    // (picking_number, customer_reference, status, lines [(sku, qty)])
    #[allow(clippy::type_complexity)]
    let lists: &[(&str, &str, &str, &[(&str, f64)])] = &[
        ("PL-DEMO-001", "Cliente demo Norte (orden #100)",   "draft",       &[
            ("TUB-RED-2", 5.0),
            ("ELE-6013",  2.0),
            ("BIS-IND-4", 4.0),
        ]),
        ("PL-DEMO-002", "Cliente demo Centro (orden #101)",  "released",    &[
            ("TUB-CUA-1", 3.0),
            ("PIN-ANT-R", 1.0),
        ]),
        ("PL-DEMO-003", "Cliente demo Sur (orden #102)",     "in_progress", &[
            ("DIS-COR-7", 5.0),
            ("TOR-14-1",  20.0),
            ("PTR-2X2",   4.0),
        ]),
    ];

    for (picking_number, customer_ref, status, lines) in lists {
        // Build status-specific timestamp columns. Driven entirely by the
        // demo timeline (1..3 days ago) so the index page sorts naturally.
        let (released_off, assigned_off, started_off, assigned_user): (
            Option<i32>,
            Option<i32>,
            Option<i32>,
            Option<Uuid>,
        ) = match *status {
            "draft" => (None, None, None, None),
            "released" => (Some(-2), None, None, None),
            "in_progress" => (Some(-3), Some(-2), Some(-1), operator_id),
            _ => (None, None, None, None),
        };

        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO picking_lists \
                 (tenant_id, picking_number, customer_reference, warehouse_id, \
                  status, allocation_strategy, notes, created_by, \
                  assigned_to_user_id, \
                  released_at, assigned_at, started_at) \
             VALUES ($1, $2, $3, $4, $5::picking_list_status, 'fefo'::picking_allocation_strategy, \
                     'Lista demo', $6, $7, \
                     CASE WHEN $8::int IS NULL THEN NULL \
                          ELSE NOW() + ($8::int || ' days')::interval END, \
                     CASE WHEN $9::int IS NULL THEN NULL \
                          ELSE NOW() + ($9::int || ' days')::interval END, \
                     CASE WHEN $10::int IS NULL THEN NULL \
                          ELSE NOW() + ($10::int || ' days')::interval END) \
             ON CONFLICT (tenant_id, picking_number) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(picking_number)
        .bind(customer_ref)
        .bind(warehouse_id)
        .bind(status)
        .bind(admin_id)
        .bind(assigned_user)
        .bind(released_off)
        .bind(assigned_off)
        .bind(started_off)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let Some(list_id) = inserted else {
            continue;
        };
        summary.picking_lists += 1;

        // Lines — auto-numbered 1..=N. The constraint trigger
        // `enforce_picking_line_warehouse_matches_list` validates
        // `warehouse_id` matches the header (we copy it explicitly).
        for (idx, (sku, qty)) in lines.iter().enumerate() {
            let product_id = match ctx.products.get(*sku) {
                Some(id) => *id,
                None => continue,
            };
            let line_number = (idx as i32) + 1;
            sqlx::query(
                "INSERT INTO picking_lines \
                     (tenant_id, picking_list_id, line_number, product_id, \
                      warehouse_id, requested_quantity, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending'::picking_line_status)",
            )
            .bind(tenant_id)
            .bind(list_id)
            .bind(line_number)
            .bind(product_id)
            .bind(warehouse_id)
            .bind(qty)
            .execute(&mut *conn)
            .await
            .map_err(map_seed_err)?;
        }
    }

    Ok(())
}

// ── seed_work_orders_extra ──────────────────────────────────────────────────
//
// Adds +2 work orders on top of the 2 draft rows from `seed_work_orders`,
// covering the remaining lifecycle states (`in_progress`, `completed`).
//
// Status notes:
//   * in_progress → `issued_at` stamped. Materials are snapshotted from
//                   the demo recipe but `quantity_consumed = 0` (the
//                   completion path would have advanced these). Safe
//                   intermediate state for UI demos.
//   * completed   → `issued_at` + `completed_at` stamped. Materials show
//                   `quantity_consumed == quantity_expected`. We do NOT
//                   stamp the FG lot / consumption movements that a real
//                   `complete` would produce — those would diverge
//                   inventory totals from `seed_core` and require a full
//                   FEFO selection. Caveat noted: the WO detail page will
//                   show "completed" with consumed quantities but no
//                   resulting FG lot. Acceptable for demo (avoids the
//                   complexity of replaying `work_orders_repo::complete`).
//
// Idempotency: same natural key as the parent helper —
// `(tenant_id, code)` UNIQUE. `ON CONFLICT DO NOTHING RETURNING id`
// short-circuits on re-run.

async fn seed_work_orders_extra(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    // Look up the demo recipe id (created in seed_recipes).
    let recipe_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM recipes \
         WHERE tenant_id = $1 AND name = 'Puerta herrería básica' AND deleted_at IS NULL \
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_seed_err)?;

    let Some(recipe_id) = recipe_id else {
        return Ok(());
    };
    let warehouse_id = ctx.warehouses["ALM"];
    let work_center_id = ctx.locations["WC-ALM"];
    let fg_product_id = ctx.products["PUE-HER-BAS"];

    // (code, status, issued_off_days, completed_off_days, mark_consumed)
    let extras: &[(&str, &str, Option<i32>, Option<i32>, bool)] = &[
        ("WO-DEMO-03", "in_progress", Some(-3), None,     false),
        ("WO-DEMO-04", "completed",   Some(-7), Some(-1), true),
    ];

    for (code, status, issued_off, completed_off, mark_consumed) in extras {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO work_orders \
                 (tenant_id, code, recipe_id, fg_product_id, fg_quantity, status, \
                  warehouse_id, work_center_location_id, notes, created_by, \
                  issued_at, completed_at) \
             VALUES ($1, $2, $3, $4, 1, $5::work_order_status, $6, $7, 'Demo work order', $8, \
                     CASE WHEN $9::int IS NULL THEN NULL \
                          ELSE NOW() + ($9::int || ' days')::interval END, \
                     CASE WHEN $10::int IS NULL THEN NULL \
                          ELSE NOW() + ($10::int || ' days')::interval END) \
             ON CONFLICT (tenant_id, code) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(code)
        .bind(recipe_id)
        .bind(fg_product_id)
        .bind(status)
        .bind(warehouse_id)
        .bind(work_center_id)
        .bind(admin_id)
        .bind(issued_off)
        .bind(completed_off)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let Some(wo_id) = inserted else {
            continue;
        };
        summary.work_orders += 1;

        // Snapshot recipe materials onto the WO. For completed orders we
        // set quantity_consumed = quantity_expected to reflect the
        // terminal state.
        let consumed_expr = if *mark_consumed {
            "ri.quantity"
        } else {
            "0"
        };
        let sql = format!(
            "INSERT INTO work_order_materials \
                 (tenant_id, work_order_id, product_id, quantity_expected, quantity_consumed) \
             SELECT $1, $2, ri.product_id, ri.quantity, {consumed_expr} \
             FROM recipe_items ri \
             WHERE ri.recipe_id = $3 \
             ON CONFLICT (work_order_id, product_id) DO NOTHING"
        );
        sqlx::query(&sql)
            .bind(tenant_id)
            .bind(wo_id)
            .bind(recipe_id)
            .execute(&mut *conn)
            .await
            .map_err(map_seed_err)?;
    }

    Ok(())
}

// ── seed_purchase_orders_extra ──────────────────────────────────────────────
//
// Adds +3 purchase orders on top of `OC-DEMO-001` (status `sent`) from
// `seed_purchase_orders`. Covers `draft`, `partially_received`, and
// `completed`. Lines mirror the original helper — 2 product lines per
// PO, total recalculated from line aggregation.
//
// For `partially_received` and `completed` PO lines we stamp
// `quantity_received` so the `/compras` UI shows progress bars. We do
// NOT spawn matching `product_lots` or `inventory` rows because those
// would either collide with the lot helper above or distort inventory
// totals — the receive flow is what would normally do that in prod.
//
// Idempotency: `(tenant_id, order_number)` UNIQUE; ON CONFLICT skips.

async fn seed_purchase_orders_extra(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    admin_id: Uuid,
    ctx: &SeedContext,
    summary: &mut SeedSummary,
) -> Result<(), DomainError> {
    // (order_number, status, supplier_key, line_a_sku, line_a_ordered, line_a_received, line_a_price,
    //                                       line_b_sku, line_b_ordered, line_b_received, line_b_price, notes)
    #[allow(clippy::type_complexity)]
    let extras: &[(&str, &str, &str, &str, f64, f64, f64, &str, f64, f64, f64, &str)] = &[
        (
            "OC-DEMO-002", "draft", "FERR-IND-MX",
            "TOR-14-1",  500.0,  0.0, 1.50,
            "BIS-IND-4", 100.0,  0.0, 32.00,
            "Borrador demo — pendiente de envío",
        ),
        (
            "OC-DEMO-003", "partially_received", "SOLD-NORTE",
            "ELE-7018",  20.0,   8.0, 350.00,
            "GAS-ARG",    3.0,   1.0, 1200.00,
            "Recepción parcial demo",
        ),
        (
            "OC-DEMO-004", "completed", "PINT-REC",
            "PIN-ANT-R", 20.0,  20.0, 220.00,
            "THI-STD",   25.0,  25.0, 95.00,
            "Pedido demo recibido completo",
        ),
    ];

    for (
        order_number, status, supplier_key,
        a_sku, a_ord, a_rcv, a_price,
        b_sku, b_ord, b_rcv, b_price,
        notes,
    ) in extras {
        let supplier_id = match ctx.suppliers.get(*supplier_key) {
            Some(id) => *id,
            None => continue,
        };
        let product_a = match ctx.products.get(*a_sku) {
            Some(id) => *id,
            None => continue,
        };
        let product_b = match ctx.products.get(*b_sku) {
            Some(id) => *id,
            None => continue,
        };

        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO purchase_orders \
                 (tenant_id, supplier_id, order_number, status, total_amount, \
                  expected_delivery_date, notes, created_by) \
             VALUES ($1, $2, $3, $4::purchase_order_status, 0, \
                     (CURRENT_DATE + INTERVAL '7 days')::date, \
                     $5, $6) \
             ON CONFLICT (tenant_id, order_number) DO NOTHING \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(supplier_id)
        .bind(order_number)
        .bind(status)
        .bind(notes)
        .bind(admin_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        let Some(po_id) = inserted else {
            continue;
        };
        summary.purchase_orders += 1;

        sqlx::query(
            "INSERT INTO purchase_order_lines \
                 (tenant_id, purchase_order_id, product_id, quantity_ordered, \
                  quantity_received, unit_price, notes) \
             VALUES \
                 ($1, $2, $3, $4, $5, $6, NULL), \
                 ($1, $2, $7, $8, $9, $10, NULL)",
        )
        .bind(tenant_id)
        .bind(po_id)
        .bind(product_a)
        .bind(a_ord)
        .bind(a_rcv)
        .bind(a_price)
        .bind(product_b)
        .bind(b_ord)
        .bind(b_rcv)
        .bind(b_price)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;

        // Update header total from line aggregation (same shape as the
        // parent helper).
        sqlx::query(
            "UPDATE purchase_orders \
             SET total_amount = ( \
                 SELECT COALESCE(SUM(quantity_ordered * unit_price), 0) \
                 FROM purchase_order_lines WHERE purchase_order_id = $1 \
             ) \
             WHERE id = $1 AND tenant_id = $2",
        )
        .bind(po_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(map_seed_err)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_strong_password() {
        assert!(validate_superadmin_password("StrongPassword12345").is_ok());
    }

    #[test]
    fn rejects_short_password() {
        let err = validate_superadmin_password("ShortPass1234XX").unwrap_err();
        assert!(err.contains("at least 16"), "unexpected reason: {err}");
    }

    #[test]
    fn rejects_password_without_uppercase() {
        let err = validate_superadmin_password("alllowercase12345").unwrap_err();
        assert!(err.contains("uppercase"), "unexpected reason: {err}");
    }

    #[test]
    fn rejects_password_without_lowercase() {
        let err = validate_superadmin_password("ALLUPPERCASE12345").unwrap_err();
        assert!(err.contains("lowercase"), "unexpected reason: {err}");
    }

    #[test]
    fn rejects_password_without_digit() {
        let err = validate_superadmin_password("NoDigitsInThisPassword").unwrap_err();
        assert!(err.contains("digit"), "unexpected reason: {err}");
    }

    #[test]
    fn seed_summary_default_is_all_zeros() {
        let s = SeedSummary::default();
        assert_eq!(s.warehouses, 0);
        assert_eq!(s.products, 0);
        assert_eq!(s.demo_users, 0);
        assert_eq!(s.memberships, 0);
    }

    #[test]
    fn seed_summary_serializes_with_snake_case_fields() {
        let s = SeedSummary {
            warehouses: 2,
            locations: 12,
            categories: 5,
            suppliers: 4,
            products: 16,
            recipes: 1,
            work_orders: 4,
            purchase_orders: 4,
            cycle_counts: 1,
            notifications: 1,
            demo_users: 3,
            memberships: 3,
            product_lots: 8,
            movements: 20,
            picking_lists: 3,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"warehouses\":2"));
        assert!(json.contains("\"demo_users\":3"));
        assert!(json.contains("\"memberships\":3"));
        assert!(json.contains("\"product_lots\":8"));
        assert!(json.contains("\"movements\":20"));
        assert!(json.contains("\"picking_lists\":3"));
    }
}
