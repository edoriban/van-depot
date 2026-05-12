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
    seed_recipes(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_work_orders(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_cycle_counts(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_notifications(conn, tenant_id, admin_id, &ctx, &mut summary).await?;
    seed_demo_users_and_memberships(conn, tenant_id, &mut summary).await?;

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
///   (warehouse_key, location_key, name, location_type, parent_key_or_None)
/// `parent_key_or_None` references another row in this same list (must come
/// later than the parent in the array). System-managed reception/finished_good
/// locations are added separately because of label/is_system specifics.
#[allow(clippy::type_complexity)]
const LOCATIONS: &[(&str, &str, &str, &str, Option<&str>)] = &[
    // Almacén Principal — top-level zones
    ("ALM", "ZONA-MATERIA-PRIMA", "Zona de materia prima", "zone",       None),
    ("ALM", "ZONA-CORTE",         "Zona de corte",         "zone",       None),
    ("ALM", "ZONA-SOLDADURA",     "Zona de soldadura",     "zone",       None),
    ("ALM", "PRODUCTO-TERMINADO", "Producto terminado",    "zone",       None),
    ("ALM", "HERRAMIENTAS",       "Herramientas",          "zone",       None),
    // Almacén Principal — children
    ("ALM", "RACK-A",             "Rack A - Tubería",      "rack",       Some("ZONA-MATERIA-PRIMA")),
    ("ALM", "RACK-B",             "Rack B - Perfiles",     "rack",       Some("ZONA-MATERIA-PRIMA")),
    ("ALM", "ESTANTE-1",          "Estante 1 - Puertas",   "shelf",      Some("PRODUCTO-TERMINADO")),
    ("ALM", "ESTANTE-2",          "Estante 2 - Ventanas",  "shelf",      Some("PRODUCTO-TERMINADO")),
    // Bodega Sur — top-level zones
    ("BOD", "BOD-GENERAL",        "Almacenamiento general","zone",       None),
    ("BOD", "BOD-SOBRANTE",       "Material sobrante",     "zone",       None),
    ("BOD", "BOD-EQUIPO",         "Equipo pesado",         "zone",       None),
    ("BOD", "BOD-CONSUMIBLES",    "Consumibles",           "zone",       None),
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
    for (wh_key, loc_key, name, ltype, parent_key) in LOCATIONS {
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
            "INSERT INTO locations (tenant_id, warehouse_id, parent_id, location_type, name) \
             VALUES ($1, $2, $3, $4::location_type, $5) \
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(warehouse_id)
        .bind(parent_id)
        .bind(ltype)
        .bind(name)
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
        ("edgar@vandev.mx", "Edgar Hernández", "owner"),
        ("luis@vandev.mx",  "Luis Torres",    "manager"),
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
            work_orders: 2,
            purchase_orders: 1,
            cycle_counts: 1,
            notifications: 1,
            demo_users: 3,
            memberships: 3,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"warehouses\":2"));
        assert!(json.contains("\"demo_users\":3"));
        assert!(json.contains("\"memberships\":3"));
    }
}
