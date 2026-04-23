use std::collections::HashMap;

use anyhow::Result;
use sqlx::{PgConnection, PgPool};
use tracing::info;
use uuid::Uuid;

use crate::auth::password::hash_password;

/// Seeds the superadmin user if one does not already exist.
///
/// Reads credentials from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` env vars,
/// falling back to development defaults when unset.
pub async fn seed_superadmin(pool: &PgPool) -> Result<()> {
    let email = std::env::var("SUPERADMIN_EMAIL")
        .unwrap_or_else(|_| "admin@vandev.mx".to_string());
    let password = std::env::var("SUPERADMIN_PASSWORD")
        .unwrap_or_else(|_| "admin123".to_string());

    // Idempotent check — skip if superadmin already exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(pool)
    .await?;

    if existing > 0 {
        info!("Superadmin already exists, skipping seed");
        return Ok(());
    }

    let password_hash = hash_password(&password)?;

    sqlx::query(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'superadmin')",
    )
    .bind(&email)
    .bind(&password_hash)
    .bind("Super Admin")
    .execute(pool)
    .await?;

    info!("Superadmin seeded: {}", email);
    Ok(())
}

/// Shared handle passed to every seed helper. Carries the IDs of entities
/// inserted during `seed_core` so downstream helpers can resolve FK references
/// by stable string key (SKU, email, warehouse code, etc.) without re-querying
/// the database.
///
/// Keys are `&'static str` slices that double as self-documenting identifiers
/// and fail fast (via HashMap panic) at seed time if a helper asks for a
/// missing entry.
struct SeedContext {
    warehouses: HashMap<&'static str, Uuid>,
    locations: HashMap<&'static str, Uuid>,
    categories: HashMap<&'static str, Uuid>,
    suppliers: HashMap<&'static str, Uuid>,
    products: HashMap<&'static str, Uuid>,
    users: HashMap<&'static str, Uuid>,
}

impl SeedContext {
    fn new() -> Self {
        Self {
            warehouses: HashMap::new(),
            locations: HashMap::new(),
            categories: HashMap::new(),
            suppliers: HashMap::new(),
            products: HashMap::new(),
            users: HashMap::new(),
        }
    }
}

/// Seeds realistic demo data for a Mexican herrería workshop.
///
/// Idempotent: skips entirely if any warehouses already exist. The short-circuit
/// runs BEFORE opening the transaction so re-runs don't create an empty
/// transaction that would immediately roll back.
///
/// All seeded inserts happen inside a single `pool.begin()` transaction: either
/// every row lands or the DB is left exactly as it was before the call.
pub async fn seed_demo_data(pool: &PgPool) -> Result<()> {
    let warehouse_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM warehouses")
        .fetch_one(pool)
        .await?;

    if warehouse_count > 0 {
        info!("Demo data already exists, skipping seed");
        return Ok(());
    }

    info!("Seeding demo data...");

    let mut tx = pool.begin().await?;

    let ctx = seed_core(&mut tx).await?;
    seed_purchase_orders(&mut tx, &ctx).await?;
    seed_lots_and_receptions(&mut tx, &ctx).await?;
    seed_purchase_returns(&mut tx, &ctx).await?;
    seed_stock_alert_tuning(&mut tx, &ctx).await?;
    seed_cycle_counts(&mut tx, &ctx).await?;
    seed_recipes(&mut tx, &ctx).await?;
    seed_notifications(&mut tx, &ctx).await?;

    tx.commit().await?;

    // Entity counts after commit (tx is consumed, use pool).
    let warehouses = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM warehouses")
        .fetch_one(pool).await.unwrap_or(-1);
    let products = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM products")
        .fetch_one(pool).await.unwrap_or(-1);
    let purchase_orders_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM purchase_orders")
        .fetch_one(pool).await.unwrap_or(-1);
    let product_lots_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM product_lots")
        .fetch_one(pool).await.unwrap_or(-1);
    let inventory_lots_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM inventory_lots")
        .fetch_one(pool).await.unwrap_or(-1);
    let purchase_returns_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM purchase_returns")
        .fetch_one(pool).await.unwrap_or(-1);
    let cycle_counts_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM cycle_counts")
        .fetch_one(pool).await.unwrap_or(-1);
    let recipes_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM recipes")
        .fetch_one(pool).await.unwrap_or(-1);
    let notifications_n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM notifications")
        .fetch_one(pool).await.unwrap_or(-1);

    info!(
        "Demo data seeded successfully: {} warehouses, {} products, {} purchase_orders, {} product_lots, {} inventory_lots, {} purchase_returns, {} cycle_counts, {} recipes, {} notifications",
        warehouses, products, purchase_orders_n, product_lots_n, inventory_lots_n,
        purchase_returns_n, cycle_counts_n, recipes_n, notifications_n
    );
    Ok(())
}

/// Seeds the foundational catalog: warehouses, locations (including a
/// per-warehouse Recepción system location), categories, suppliers, products,
/// initial inventory, 20 historical movements, demo users, and user-warehouse
/// assignments.
///
/// Every insert binds to `&mut *tx` so the caller's outer transaction retains
/// control of commit/rollback.
async fn seed_core(tx: &mut PgConnection) -> Result<SeedContext> {
    let mut ctx = SeedContext::new();

    // Superadmin user_id (used as created_by / user_id for historical movements
    // and the initial user_warehouses assignment).
    let superadmin_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1",
    )
    .fetch_one(&mut *tx)
    .await?;
    ctx.users.insert("admin@vandev.mx", superadmin_id);

    // ── 1. Warehouses ────────────────────────────────────────────────
    let almacen_principal_id = Uuid::new_v4();
    let bodega_sur_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO warehouses (id, name, address) VALUES ($1, $2, $3), ($4, $5, $6)",
    )
    .bind(almacen_principal_id)
    .bind("Almacén Principal")
    .bind("Av. Industria #450, Col. Industrial, Monterrey, NL")
    .bind(bodega_sur_id)
    .bind("Bodega Sur")
    .bind("Calle 5 de Mayo #120, Col. Centro, Monterrey, NL")
    .execute(&mut *tx)
    .await?;

    ctx.warehouses.insert("ALM", almacen_principal_id);
    ctx.warehouses.insert("BOD", bodega_sur_id);

    // ── 2. Locations — Almacén Principal ─────────────────────────────
    let zona_materia_prima_id = Uuid::new_v4();
    let rack_a_id = Uuid::new_v4();
    let rack_b_id = Uuid::new_v4();
    let zona_corte_id = Uuid::new_v4();
    let zona_soldadura_id = Uuid::new_v4();
    let producto_terminado_id = Uuid::new_v4();
    let estante_1_id = Uuid::new_v4();
    let estante_2_id = Uuid::new_v4();
    let herramientas_id = Uuid::new_v4();

    // Top-level zones for Almacén Principal
    sqlx::query(
        "INSERT INTO locations (id, warehouse_id, parent_id, location_type, name) VALUES
         ($1, $2, NULL, 'zone', 'Zona de materia prima'),
         ($3, $2, NULL, 'zone', 'Zona de corte'),
         ($4, $2, NULL, 'zone', 'Zona de soldadura'),
         ($5, $2, NULL, 'zone', 'Producto terminado'),
         ($6, $2, NULL, 'zone', 'Herramientas')",
    )
    .bind(zona_materia_prima_id)
    .bind(almacen_principal_id)
    .bind(zona_corte_id)
    .bind(zona_soldadura_id)
    .bind(producto_terminado_id)
    .bind(herramientas_id)
    .execute(&mut *tx)
    .await?;

    // Child locations (racks/shelves)
    sqlx::query(
        "INSERT INTO locations (id, warehouse_id, parent_id, location_type, name) VALUES
         ($1, $2, $3, 'rack', 'Rack A - Tubería'),
         ($4, $2, $3, 'rack', 'Rack B - Perfiles'),
         ($5, $2, $6, 'shelf', 'Estante 1 - Puertas'),
         ($7, $2, $6, 'shelf', 'Estante 2 - Ventanas')",
    )
    .bind(rack_a_id)
    .bind(almacen_principal_id)
    .bind(zona_materia_prima_id)
    .bind(rack_b_id)
    .bind(estante_1_id)
    .bind(producto_terminado_id)
    .bind(estante_2_id)
    .execute(&mut *tx)
    .await?;

    // ── 3. Locations — Bodega Sur ────────────────────────────────────
    let bodega_general_id = Uuid::new_v4();
    let bodega_sobrante_id = Uuid::new_v4();
    let bodega_equipo_id = Uuid::new_v4();
    let bodega_consumibles_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO locations (id, warehouse_id, parent_id, location_type, name) VALUES
         ($1, $2, NULL, 'zone', 'Almacenamiento general'),
         ($3, $2, NULL, 'zone', 'Material sobrante'),
         ($4, $2, NULL, 'zone', 'Equipo pesado'),
         ($5, $2, NULL, 'zone', 'Consumibles')",
    )
    .bind(bodega_general_id)
    .bind(bodega_sur_id)
    .bind(bodega_sobrante_id)
    .bind(bodega_equipo_id)
    .bind(bodega_consumibles_id)
    .execute(&mut *tx)
    .await?;

    // ── 3b. Recepción system locations (one per warehouse) ───────────
    // The migration `20260418000002_reception_location` backfills a Recepción
    // row for every warehouse that exists at migration time. Because the app
    // runs migrations BEFORE this seed, warehouses inserted just above are
    // newer than the backfill and would otherwise have no Recepción row —
    // which would break the receive_lot flow at runtime. We create them
    // explicitly here, matching the backfill's column set exactly
    // (label='RCP', is_system=true, layout box 0/0/100/100).
    let rcp_alm_id = Uuid::new_v4();
    let rcp_bod_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO locations
             (id, warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
         VALUES
             ($1, $2, 'reception', 'Recepción', 'RCP', TRUE, 0, 0, 100, 100),
             ($3, $4, 'reception', 'Recepción', 'RCP', TRUE, 0, 0, 100, 100)",
    )
    .bind(rcp_alm_id)
    .bind(almacen_principal_id)
    .bind(rcp_bod_id)
    .bind(bodega_sur_id)
    .execute(&mut *tx)
    .await?;

    // Populate every location key downstream helpers may need. Keys match the
    // design doc's `ctx.locations["..."]` vocabulary.
    ctx.locations.insert("ZONA-MATERIA-PRIMA", zona_materia_prima_id);
    ctx.locations.insert("RACK-A", rack_a_id);
    ctx.locations.insert("RACK-B", rack_b_id);
    ctx.locations.insert("ZONA-CORTE", zona_corte_id);
    ctx.locations.insert("ZONA-SOLDADURA", zona_soldadura_id);
    ctx.locations.insert("PRODUCTO-TERMINADO", producto_terminado_id);
    ctx.locations.insert("ESTANTE-1", estante_1_id);
    ctx.locations.insert("ESTANTE-2", estante_2_id);
    ctx.locations.insert("HERRAMIENTAS", herramientas_id);
    ctx.locations.insert("BOD-GENERAL", bodega_general_id);
    ctx.locations.insert("BOD-SOBRANTE", bodega_sobrante_id);
    ctx.locations.insert("BOD-EQUIPO", bodega_equipo_id);
    ctx.locations.insert("BOD-CONSUMIBLES", bodega_consumibles_id);
    ctx.locations.insert("RCP-ALM", rcp_alm_id);
    ctx.locations.insert("RCP-BOD", rcp_bod_id);

    // ── 4. Categories ────────────────────────────────────────────────
    let cat_aceros_id = Uuid::new_v4();
    let cat_soldadura_id = Uuid::new_v4();
    let cat_herramientas_id = Uuid::new_v4();
    let cat_pinturas_id = Uuid::new_v4();
    let cat_tornilleria_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO categories (id, name) VALUES
         ($1, 'Aceros y metales'),
         ($2, 'Soldadura y consumibles'),
         ($3, 'Herramientas'),
         ($4, 'Pinturas y acabados'),
         ($5, 'Tornillería y herrajes')",
    )
    .bind(cat_aceros_id)
    .bind(cat_soldadura_id)
    .bind(cat_herramientas_id)
    .bind(cat_pinturas_id)
    .bind(cat_tornilleria_id)
    .execute(&mut *tx)
    .await?;

    ctx.categories.insert("ACEROS", cat_aceros_id);
    ctx.categories.insert("SOLD", cat_soldadura_id);
    ctx.categories.insert("HERR", cat_herramientas_id);
    ctx.categories.insert("PINT", cat_pinturas_id);
    ctx.categories.insert("TORN", cat_tornilleria_id);

    // ── 5. Suppliers ─────────────────────────────────────────────────
    let sup_aceros_id = Uuid::new_v4();
    let sup_soldaduras_id = Uuid::new_v4();
    let sup_ferreteria_id = Uuid::new_v4();
    let sup_pinturas_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO suppliers (id, name, contact_name, phone, email) VALUES
         ($1, 'Aceros Monterrey SA', 'Juan García', '818-555-0101', 'ventas@acerosmonterrey.mx'),
         ($2, 'Soldaduras del Norte', 'María López', '818-555-0202', 'contacto@soldanorte.mx'),
         ($3, 'Ferretería Industrial MX', 'Pedro Ramírez', '818-555-0303', 'pedidos@ferremx.mx'),
         ($4, 'Pinturas y Recubrimientos SA', 'Ana Torres', '818-555-0404', 'ventas@pinturasyr.mx')",
    )
    .bind(sup_aceros_id)
    .bind(sup_soldaduras_id)
    .bind(sup_ferreteria_id)
    .bind(sup_pinturas_id)
    .execute(&mut *tx)
    .await?;

    ctx.suppliers.insert("ACEROS-MTY", sup_aceros_id);
    ctx.suppliers.insert("SOLD-NORTE", sup_soldaduras_id);
    ctx.suppliers.insert("FERR-IND-MX", sup_ferreteria_id);
    ctx.suppliers.insert("PINT-REC", sup_pinturas_id);

    // ── 6. Products ──────────────────────────────────────────────────
    let prod_tubo_red = Uuid::new_v4();
    let prod_tubo_cua = Uuid::new_v4();
    let prod_ptr = Uuid::new_v4();
    let prod_angulo = Uuid::new_v4();
    let prod_lamina = Uuid::new_v4();
    let prod_solera = Uuid::new_v4();
    let prod_ele_6013 = Uuid::new_v4();
    let prod_ele_7018 = Uuid::new_v4();
    let prod_gas_arg = Uuid::new_v4();
    let prod_disco_corte = Uuid::new_v4();
    let prod_disco_desb = Uuid::new_v4();
    let prod_pintura = Uuid::new_v4();
    let prod_thinner = Uuid::new_v4();
    let prod_tornillo = Uuid::new_v4();
    let prod_bisagra = Uuid::new_v4();

    // Per-SKU product_class + has_expiry per design §7:
    //   raw_material (10): TUB-RED-2, TUB-CUA-1, PTR-2X2, ANG-1-18, LAM-C14,
    //     SOL-1-14, ELE-6013, ELE-7018, TOR-14-1, BIS-IND-4 — all has_expiry=false.
    //   consumable  (3): GAS-ARG (no expiry), PIN-ANT-R (with expiry), THI-STD (with expiry).
    //   tool_spare  (2): DIS-COR-7, DIS-DES-7 — both has_expiry=false (DB CHECK).
    // Values are passed explicitly (not relying on the DEFAULT 'raw_material')
    // so the seed exercises the full classification surface end-to-end.
    sqlx::query(
        "INSERT INTO products (id, name, sku, category_id, unit_of_measure, min_stock, max_stock, product_class, has_expiry) VALUES
         ($1,  'Tubo redondo 2\"',        'TUB-RED-2', $16, 'meter', 20, 100, 'raw_material', FALSE),
         ($2,  'Tubo cuadrado 1\"',       'TUB-CUA-1', $16, 'meter', 15, 80,  'raw_material', FALSE),
         ($3,  'Perfil PTR 2x2',         'PTR-2X2',   $16, 'meter', 10, 50,  'raw_material', FALSE),
         ($4,  'Ángulo 1\"x1/8\"',       'ANG-1-18',  $16, 'meter', 10, 40,  'raw_material', FALSE),
         ($5,  'Lámina cal 14',          'LAM-C14',   $16, 'piece', 5,  20,  'raw_material', FALSE),
         ($6,  'Solera 1\"x1/4\"',       'SOL-1-14',  $16, 'meter', 10, 50,  'raw_material', FALSE),
         ($7,  'Electrodo 6013',         'ELE-6013',  $17, 'kg',    5,  25,  'raw_material', FALSE),
         ($8,  'Electrodo 7018',         'ELE-7018',  $17, 'kg',    3,  15,  'raw_material', FALSE),
         ($9,  'Gas argón tanque',       'GAS-ARG',   $17, 'piece', 1,  3,   'consumable',   FALSE),
         ($10, 'Disco de corte 7\"',     'DIS-COR-7', $18, 'piece', 10, 50,  'tool_spare',   FALSE),
         ($11, 'Disco de desbaste 7\"',  'DIS-DES-7', $18, 'piece', 5,  30,  'tool_spare',   FALSE),
         ($12, 'Pintura anticorrosiva roja', 'PIN-ANT-R', $19, 'liter', 4, 20, 'consumable', TRUE),
         ($13, 'Thinner',                'THI-STD',   $19, 'liter', 5,  25,  'consumable',   TRUE),
         ($14, 'Tornillo 1/4\"x1\"',     'TOR-14-1',  $20, 'piece', 100, 500, 'raw_material', FALSE),
         ($15, 'Bisagra industrial 4\"', 'BIS-IND-4', $20, 'piece', 20, 100, 'raw_material', FALSE)",
    )
    .bind(prod_tubo_red)      // $1
    .bind(prod_tubo_cua)      // $2
    .bind(prod_ptr)           // $3
    .bind(prod_angulo)        // $4
    .bind(prod_lamina)        // $5
    .bind(prod_solera)        // $6
    .bind(prod_ele_6013)      // $7
    .bind(prod_ele_7018)      // $8
    .bind(prod_gas_arg)       // $9
    .bind(prod_disco_corte)   // $10
    .bind(prod_disco_desb)    // $11
    .bind(prod_pintura)       // $12
    .bind(prod_thinner)       // $13
    .bind(prod_tornillo)      // $14
    .bind(prod_bisagra)       // $15
    .bind(cat_aceros_id)      // $16
    .bind(cat_soldadura_id)   // $17
    .bind(cat_herramientas_id) // $18
    .bind(cat_pinturas_id)    // $19
    .bind(cat_tornilleria_id) // $20
    .execute(&mut *tx)
    .await?;

    ctx.products.insert("TUB-RED-2", prod_tubo_red);
    ctx.products.insert("TUB-CUA-1", prod_tubo_cua);
    ctx.products.insert("PTR-2X2", prod_ptr);
    ctx.products.insert("ANG-1-18", prod_angulo);
    ctx.products.insert("LAM-C14", prod_lamina);
    ctx.products.insert("SOL-1-14", prod_solera);
    ctx.products.insert("ELE-6013", prod_ele_6013);
    ctx.products.insert("ELE-7018", prod_ele_7018);
    ctx.products.insert("GAS-ARG", prod_gas_arg);
    ctx.products.insert("DIS-COR-7", prod_disco_corte);
    ctx.products.insert("DIS-DES-7", prod_disco_desb);
    ctx.products.insert("PIN-ANT-R", prod_pintura);
    ctx.products.insert("THI-STD", prod_thinner);
    ctx.products.insert("TOR-14-1", prod_tornillo);
    ctx.products.insert("BIS-IND-4", prod_bisagra);

    // seed uses raw INSERT bypassing repo guards
    // 5.2: Seed tool_spare instances. Raw INSERT bypasses repo guards (seed is privileged).
    // DIS-COR-7 → 3 serials, DIS-DES-7 → 2 serials, all status='available' and
    // parked at the almacén-principal Recepción (RCP-ALM) so the dev catalog
    // mirrors the "everything enters through Recepción" invariant. The app-layer
    // class check in tool_instances_repo::create_tool_instance is exercised by
    // tests, not by the seed.
    sqlx::query(
        "INSERT INTO tool_instances (product_id, serial, status, location_id) VALUES
         ($1, 'DIS-COR-7-SN-001', 'available', $3),
         ($1, 'DIS-COR-7-SN-002', 'available', $3),
         ($1, 'DIS-COR-7-SN-003', 'available', $3),
         ($2, 'DIS-DES-7-SN-001', 'available', $3),
         ($2, 'DIS-DES-7-SN-002', 'available', $3)",
    )
    .bind(prod_disco_corte) // $1
    .bind(prod_disco_desb)  // $2
    .bind(rcp_alm_id)       // $3
    .execute(&mut *tx)
    .await?;

    // ── 7. Inventory ─────────────────────────────────────────────────
    sqlx::query(
        "INSERT INTO inventory (product_id, location_id, quantity) VALUES
         ($1,  $6, 45),
         ($2,  $6, 30),
         ($3,  $6, 25),
         ($4,  $7, 35),
         ($5,  $7, 28),
         ($8,  $7, 12),
         ($9,  $10, 8),
         ($11, $10, 4),
         ($12, $10, 2),
         ($13, $14, 25),
         ($15, $14, 15),
         ($16, $17, 10),
         ($18, $17, 8),
         ($19, $17, 200),
         ($20, $17, 45)",
    )
    .bind(prod_tubo_red)    // $1 — Rack A
    .bind(prod_tubo_cua)    // $2
    .bind(prod_ptr)         // $3
    .bind(prod_angulo)      // $4 — Rack B
    .bind(prod_solera)      // $5
    .bind(rack_a_id)        // $6
    .bind(rack_b_id)        // $7
    .bind(prod_lamina)      // $8
    .bind(prod_ele_6013)    // $9 — Zona soldadura
    .bind(zona_soldadura_id) // $10
    .bind(prod_ele_7018)    // $11
    .bind(prod_gas_arg)     // $12
    .bind(prod_disco_corte) // $13 — Herramientas
    .bind(herramientas_id)  // $14
    .bind(prod_disco_desb)  // $15
    .bind(prod_pintura)     // $16 — Bodega Sur general
    .bind(bodega_general_id) // $17
    .bind(prod_thinner)     // $18
    .bind(prod_tornillo)    // $19
    .bind(prod_bisagra)     // $20
    .execute(&mut *tx)
    .await?;

    // ── 8. Movements (20 historical over the last 7 days) ───────────
    // Use individual inserts for clarity and correct bind parameter numbering.

    // -- 15 entry movements from suppliers --
    // 1. Tubo redondo entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 60, 'entry', $3, 'OC-2026-001', 'Compra semanal de tubo redondo', $4, NOW() - INTERVAL '7 days')",
    )
    .bind(prod_tubo_red).bind(rack_a_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 2. Tubo cuadrado entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 40, 'entry', $3, 'OC-2026-001', 'Compra semanal de tubo cuadrado', $4, NOW() - INTERVAL '7 days' + INTERVAL '1 hour')",
    )
    .bind(prod_tubo_cua).bind(rack_a_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 3. PTR entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 30, 'entry', $3, 'OC-2026-002', 'Resurtido de PTR', $4, NOW() - INTERVAL '6 days')",
    )
    .bind(prod_ptr).bind(rack_a_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 4. Ángulo entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 50, 'entry', $3, 'OC-2026-003', 'Compra de ángulo', $4, NOW() - INTERVAL '6 days' + INTERVAL '3 hours')",
    )
    .bind(prod_angulo).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 5. Solera entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 35, 'entry', $3, 'OC-2026-003', 'Compra de solera', $4, NOW() - INTERVAL '5 days')",
    )
    .bind(prod_solera).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 6. Lámina entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 15, 'entry', $3, 'OC-2026-004', 'Láminas calibre 14', $4, NOW() - INTERVAL '5 days' + INTERVAL '2 hours')",
    )
    .bind(prod_lamina).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(&mut *tx).await?;

    // 7. Electrodo 6013 entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 12, 'entry', $3, 'OC-2026-005', 'Electrodos 6013 para la semana', $4, NOW() - INTERVAL '4 days')",
    )
    .bind(prod_ele_6013).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(&mut *tx).await?;

    // 8. Electrodo 7018 entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 6, 'entry', $3, 'OC-2026-005', 'Electrodos 7018', $4, NOW() - INTERVAL '4 days' + INTERVAL '30 minutes')",
    )
    .bind(prod_ele_7018).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(&mut *tx).await?;

    // 9. Gas argón entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 3, 'entry', $3, 'OC-2026-006', 'Tanques de argón', $4, NOW() - INTERVAL '4 days' + INTERVAL '2 hours')",
    )
    .bind(prod_gas_arg).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(&mut *tx).await?;

    // 10. Disco de corte entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 30, 'entry', $3, 'OC-2026-007', 'Discos de corte', $4, NOW() - INTERVAL '3 days')",
    )
    .bind(prod_disco_corte).bind(herramientas_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(&mut *tx).await?;

    // 11. Disco de desbaste entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 20, 'entry', $3, 'OC-2026-007', 'Discos de desbaste', $4, NOW() - INTERVAL '3 days' + INTERVAL '1 hour')",
    )
    .bind(prod_disco_desb).bind(herramientas_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(&mut *tx).await?;

    // 12. Pintura entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 15, 'entry', $3, 'OC-2026-008', 'Pintura anticorrosiva', $4, NOW() - INTERVAL '3 days' + INTERVAL '4 hours')",
    )
    .bind(prod_pintura).bind(bodega_general_id).bind(superadmin_id).bind(sup_pinturas_id)
    .execute(&mut *tx).await?;

    // 13. Thinner entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 12, 'entry', $3, 'OC-2026-008', 'Thinner estándar', $4, NOW() - INTERVAL '2 days')",
    )
    .bind(prod_thinner).bind(bodega_general_id).bind(superadmin_id).bind(sup_pinturas_id)
    .execute(&mut *tx).await?;

    // 14. Tornillo entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 300, 'entry', $3, 'OC-2026-009', 'Tornillos 1/4', $4, NOW() - INTERVAL '2 days' + INTERVAL '3 hours')",
    )
    .bind(prod_tornillo).bind(bodega_general_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(&mut *tx).await?;

    // 15. Bisagra entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 60, 'entry', $3, 'OC-2026-009', 'Bisagras industriales', $4, NOW() - INTERVAL '2 days' + INTERVAL '4 hours')",
    )
    .bind(prod_bisagra).bind(bodega_general_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(&mut *tx).await?;

    // -- 3 exit movements (material consumed for projects) --
    // 16. Tubo redondo exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 15, 'exit', $3, 'PROY-2026-010', 'Proyecto puerta herrería García', NOW() - INTERVAL '1 day')",
    )
    .bind(prod_tubo_red).bind(rack_a_id).bind(superadmin_id)
    .execute(&mut *tx).await?;

    // 17. Tubo cuadrado exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 10, 'exit', $3, 'PROY-2026-010', 'Proyecto puerta herrería García', NOW() - INTERVAL '1 day' + INTERVAL '2 hours')",
    )
    .bind(prod_tubo_cua).bind(rack_a_id).bind(superadmin_id)
    .execute(&mut *tx).await?;

    // 18. Electrodo 6013 exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 4, 'exit', $3, 'PROY-2026-010', 'Electrodos consumidos en proyecto', NOW() - INTERVAL '1 day' + INTERVAL '4 hours')",
    )
    .bind(prod_ele_6013).bind(zona_soldadura_id).bind(superadmin_id)
    .execute(&mut *tx).await?;

    // -- 1 transfer movement --
    // 19. Transfer pintura from Bodega Sur to Almacén Principal
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, $3, 5, 'transfer', $4, 'TRANS-001', 'Transferencia de pintura a almacén principal', NOW() - INTERVAL '12 hours')",
    )
    .bind(prod_pintura).bind(bodega_general_id).bind(herramientas_id).bind(superadmin_id)
    .execute(&mut *tx).await?;

    // -- 1 adjustment movement --
    // 20. Lámina adjustment (damaged stock)
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, NULL, $2, -3, 'adjustment', $3, 'AJUSTE-001', 'Ajuste por inventario físico — láminas dañadas', NOW() - INTERVAL '6 hours')",
    )
    .bind(prod_lamina).bind(rack_b_id).bind(superadmin_id)
    .execute(&mut *tx).await?;

    // ── 9. Additional users ──────────────────────────────────────────
    let demo_hash = hash_password("demo123")?;

    let carlos_id = Uuid::new_v4();
    let miguel_id = Uuid::new_v4();
    let laura_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, name, role) VALUES
         ($1, 'carlos@vandev.mx', $4, 'Carlos Hernández', 'warehouse_manager'),
         ($2, 'miguel@vandev.mx', $4, 'Miguel Torres', 'operator'),
         ($3, 'laura@vandev.mx',  $4, 'Laura Díaz', 'operator')",
    )
    .bind(carlos_id)
    .bind(miguel_id)
    .bind(laura_id)
    .bind(&demo_hash)
    .execute(&mut *tx)
    .await?;

    ctx.users.insert("carlos@vandev.mx", carlos_id);
    ctx.users.insert("miguel@vandev.mx", miguel_id);
    ctx.users.insert("laura@vandev.mx", laura_id);

    // Assign users to warehouses
    sqlx::query(
        "INSERT INTO user_warehouses (user_id, warehouse_id) VALUES
         ($1, $4),
         ($2, $4),
         ($3, $4),
         ($3, $5),
         ($6, $4),
         ($6, $5)",
    )
    .bind(carlos_id)           // $1 — Carlos → Almacén Principal
    .bind(miguel_id)           // $2 — Miguel → Almacén Principal
    .bind(laura_id)            // $3 — Laura → both
    .bind(almacen_principal_id) // $4
    .bind(bodega_sur_id)       // $5
    .bind(superadmin_id)       // $6 — Superadmin → both
    .execute(&mut *tx)
    .await?;

    Ok(ctx)
}

// ── Phase 1 ─ Purchase Orders ─────────────────────────────────────────
//
// Seeds 5 purchase orders covering every status the UI must exercise: 1 draft,
// 2 sent (one upcoming, one overdue vs CURRENT_DATE), 1 partially_received,
// 1 completed. Each PO has ≥2 lines. `total_amount` is computed via an UPDATE
// after all lines are inserted — mirrors the repo's contract so demo numbers
// stay self-consistent.
async fn seed_purchase_orders(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let admin = ctx.users["admin@vandev.mx"];

    let po_100 = Uuid::new_v4(); // draft
    let po_101 = Uuid::new_v4(); // sent, upcoming
    let po_102 = Uuid::new_v4(); // sent, overdue
    let po_103 = Uuid::new_v4(); // partially_received
    let po_104 = Uuid::new_v4(); // completed

    // Headers — total_amount updated after line inserts.
    sqlx::query(
        "INSERT INTO purchase_orders
             (id, supplier_id, order_number, status, total_amount, expected_delivery_date, notes, created_by, created_at)
         VALUES
             ($1,  $2,  'OC-2026-100', 'draft',              0, (CURRENT_DATE + INTERVAL '15 days')::date, 'Borrador pendiente de aprobación', $11, NOW() - INTERVAL '2 days'),
             ($3,  $4,  'OC-2026-101', 'sent',               0, (CURRENT_DATE + INTERVAL '7 days')::date,  'Pedido enviado a proveedor', $11,  NOW() - INTERVAL '5 days'),
             ($5,  $6,  'OC-2026-102', 'sent',               0, (CURRENT_DATE - INTERVAL '3 days')::date,  'Pedido vencido — dar seguimiento', $11, NOW() - INTERVAL '12 days'),
             ($7,  $8,  'OC-2026-103', 'partially_received', 0, (CURRENT_DATE - INTERVAL '5 days')::date,  'Recepción parcial — falta lámina', $11, NOW() - INTERVAL '15 days'),
             ($9,  $10, 'OC-2026-104', 'completed',          0, (CURRENT_DATE - INTERVAL '10 days')::date, 'Pedido recibido y cerrado',        $11, NOW() - INTERVAL '25 days')",
    )
    .bind(po_100).bind(ctx.suppliers["ACEROS-MTY"])
    .bind(po_101).bind(ctx.suppliers["SOLD-NORTE"])
    .bind(po_102).bind(ctx.suppliers["PINT-REC"])
    .bind(po_103).bind(ctx.suppliers["ACEROS-MTY"])
    .bind(po_104).bind(ctx.suppliers["FERR-IND-MX"])
    .bind(admin)
    .execute(&mut *tx)
    .await?;

    // Lines — OC-2026-100 (draft, 2 lines)
    sqlx::query(
        "INSERT INTO purchase_order_lines
             (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price, notes)
         VALUES
             ($1, $2, 80, 0, 180.00, 'Tubo redondo 2 pulgadas — lote grande'),
             ($1, $3, 10, 0, 950.00, 'Láminas calibre 14')",
    )
    .bind(po_100).bind(ctx.products["TUB-RED-2"]).bind(ctx.products["LAM-C14"])
    .execute(&mut *tx)
    .await?;

    // OC-2026-101 (sent, upcoming — 2 lines)
    sqlx::query(
        "INSERT INTO purchase_order_lines
             (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price, notes)
         VALUES
             ($1, $2, 20, 0, 220.00, 'Electrodos 6013 para producción'),
             ($1, $3, 2,  0, 1800.00, 'Tanques de argón')",
    )
    .bind(po_101).bind(ctx.products["ELE-6013"]).bind(ctx.products["GAS-ARG"])
    .execute(&mut *tx)
    .await?;

    // OC-2026-102 (sent, overdue — 2 lines)
    sqlx::query(
        "INSERT INTO purchase_order_lines
             (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price, notes)
         VALUES
             ($1, $2, 24, 0, 185.00, 'Pintura anticorrosiva — caja de 24'),
             ($1, $3, 20, 0, 95.00,  'Thinner estándar')",
    )
    .bind(po_102).bind(ctx.products["PIN-ANT-R"]).bind(ctx.products["THI-STD"])
    .execute(&mut *tx)
    .await?;

    // OC-2026-103 (partially_received — 3 lines, at least one with partial receipt)
    sqlx::query(
        "INSERT INTO purchase_order_lines
             (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price, notes)
         VALUES
             ($1, $2, 40, 20, 160.00, 'Tubo cuadrado — recibido parcial'),
             ($1, $3, 30, 15, 240.00, 'Perfil PTR — recibido parcial'),
             ($1, $4,  8,  5, 950.00, 'Láminas calibre 14 — 3 aún en tránsito')",
    )
    .bind(po_103)
    .bind(ctx.products["TUB-CUA-1"])
    .bind(ctx.products["PTR-2X2"])
    .bind(ctx.products["LAM-C14"])
    .execute(&mut *tx)
    .await?;

    // OC-2026-104 (completed — 3 lines, all fully received)
    sqlx::query(
        "INSERT INTO purchase_order_lines
             (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price, notes)
         VALUES
             ($1, $2, 30,  30, 55.00,  'Discos de desbaste'),
             ($1, $3,  8,   8, 280.00, 'Electrodos 7018'),
             ($1, $4, 500, 500, 2.50,  'Tornillería')",
    )
    .bind(po_104)
    .bind(ctx.products["DIS-DES-7"])
    .bind(ctx.products["ELE-7018"])
    .bind(ctx.products["TOR-14-1"])
    .execute(&mut *tx)
    .await?;

    // UPDATE total_amount for all 5 POs from line sums.
    for po_id in [po_100, po_101, po_102, po_103, po_104] {
        sqlx::query(
            "UPDATE purchase_orders
             SET total_amount = (
                 SELECT COALESCE(SUM(quantity_ordered * unit_price), 0)
                 FROM purchase_order_lines WHERE purchase_order_id = $1
             )
             WHERE id = $1",
        )
        .bind(po_id)
        .execute(&mut *tx)
        .await?;
    }

    Ok(())
}

// ── Phase 2 ─ Lots, inventory_lots, Recepción flow ────────────────────
//
// Seeds product_lots (15 rows across 6 consumables) with a deliberate quality
// / expiration distribution: 1 expired, 2 near-expiration (10–30 days ahead),
// ≥1 pending, ≥1 quarantine, ≥1 rejected. Splits each lot into inventory_lots
// across one or more locations — 5 rows intentionally sit in Recepción to
// drive the distribute flow. Bumps the product-level `inventory` table so the
// aggregate view reconciles. Ends with 4 entry movements into Recepción and
// 2 transfer movements (one from BOD-GENERAL → HERRAMIENTAS, one from RACK-B
// → BOD-SOBRANTE) to demonstrate the receiving → racking narrative.
//
// NOTE: This helper bypasses `LotsRepository::receive_lot` on purpose — it
// maintains the same invariants (product_lots + inventory_lots + movements +
// inventory delta) manually so the seed is self-contained. Do NOT copy this
// pattern outside of seed code.
async fn seed_lots_and_receptions(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let admin = ctx.users["admin@vandev.mx"];

    // Resolve the purchase_order_line IDs we need to tie some lots to real POs.
    // (Helper queries — small and clear-cut.)
    let po_101_ele_6013_line = sqlx::query_scalar::<_, Uuid>(
        "SELECT l.id FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.purchase_order_id
         WHERE po.order_number = 'OC-2026-101' AND l.product_id = $1",
    )
    .bind(ctx.products["ELE-6013"])
    .fetch_one(&mut *tx)
    .await?;
    let po_101_gas_line = sqlx::query_scalar::<_, Uuid>(
        "SELECT l.id FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.purchase_order_id
         WHERE po.order_number = 'OC-2026-101' AND l.product_id = $1",
    )
    .bind(ctx.products["GAS-ARG"])
    .fetch_one(&mut *tx)
    .await?;
    let po_103_lam_line = sqlx::query_scalar::<_, Uuid>(
        "SELECT l.id FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.purchase_order_id
         WHERE po.order_number = 'OC-2026-103' AND l.product_id = $1",
    )
    .bind(ctx.products["LAM-C14"])
    .fetch_one(&mut *tx)
    .await?;
    let po_104_ele_7018_line = sqlx::query_scalar::<_, Uuid>(
        "SELECT l.id FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.purchase_order_id
         WHERE po.order_number = 'OC-2026-104' AND l.product_id = $1",
    )
    .bind(ctx.products["ELE-7018"])
    .fetch_one(&mut *tx)
    .await?;
    // ── Product lots (15) ────────────────────────────────────────────
    // Temporal distribution (all relative to CURRENT_DATE):
    //   expired  (== now - 30d):  LOT-PIN-2026-03
    //   near-exp (10 – 30d ahead): LOT-THI-2026-01  (+20d), LOT-ELE-6013-02 is
    //                               NULL — so we set LOT-PIN-2026-02's exp to
    //                               +25d below so we land exactly at 2 rows in
    //                               the 10–30 window. *revisited*: we keep
    //                               LOT-PIN-2026-02 at +350d to avoid collision
    //                               with spec's "other lots > +90d". Instead
    //                               add a second near-exp lot below.
    //   future   (> 90d):          most lots
    //   NULL:                      gas argón, lámina, tornillería (no expiry)
    //
    // Final count of expiration windows:
    //   expired (= now - 30d): 1  → LOT-PIN-2026-03
    //   in (now+10d, now+30d]: 2  → LOT-THI-2026-01 (+20d), LOT-ELE-7018-02 (+25d)
    //   future (> now+90d):    5  → rest with dates
    //   NULL:                  7  → GAS/LAM/TOR
    let lot_pin_01 = Uuid::new_v4();
    let lot_pin_02 = Uuid::new_v4();
    let lot_pin_03 = Uuid::new_v4();
    let lot_thi_01 = Uuid::new_v4();
    let lot_thi_02 = Uuid::new_v4();
    let lot_ele6013_01 = Uuid::new_v4();
    let lot_ele6013_02 = Uuid::new_v4();
    let lot_ele7018_01 = Uuid::new_v4();
    let lot_ele7018_02 = Uuid::new_v4();
    let lot_gas_01 = Uuid::new_v4();
    let lot_gas_02 = Uuid::new_v4();
    let lot_lam_01 = Uuid::new_v4();
    let lot_lam_02 = Uuid::new_v4();
    let lot_lam_03 = Uuid::new_v4();
    let lot_ele6013_03 = Uuid::new_v4();

    // Pintura lots (3 — one approved baseline, one approved second batch, one quarantined EXPIRED).
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes)
         VALUES
             ($1, $2, 'LOT-PIN-2026-01', (CURRENT_DATE - INTERVAL '45 days')::date, (CURRENT_DATE + INTERVAL '320 days')::date, $3, 10, 'approved', 'Lote inicial de pintura roja'),
             ($4, $2, 'LOT-PIN-2026-02', (CURRENT_DATE - INTERVAL '15 days')::date, (CURRENT_DATE + INTERVAL '350 days')::date, $3, 8,  'approved', 'Segundo lote de pintura roja'),
             ($5, $2, 'LOT-PIN-2026-03', (CURRENT_DATE - INTERVAL '400 days')::date, (CURRENT_DATE - INTERVAL '30 days')::date, $3, 2,  'quarantine', 'Lote caducado en cuarentena')",
    )
    .bind(lot_pin_01).bind(ctx.products["PIN-ANT-R"]).bind(ctx.suppliers["PINT-REC"])
    .bind(lot_pin_02).bind(lot_pin_03)
    .execute(&mut *tx)
    .await?;

    // Thinner lots (2) — LOT-THI-2026-01 near-expiration window.
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes)
         VALUES
             ($1, $2, 'LOT-THI-2026-01', (CURRENT_DATE - INTERVAL '60 days')::date, (CURRENT_DATE + INTERVAL '20 days')::date,  $3, 15, 'approved', 'Thinner lote antiguo — casi por caducar'),
             ($4, $2, 'LOT-THI-2026-02', (CURRENT_DATE - INTERVAL '10 days')::date, (CURRENT_DATE + INTERVAL '180 days')::date, $3, 10, 'approved', 'Thinner lote reciente')",
    )
    .bind(lot_thi_01).bind(ctx.products["THI-STD"]).bind(ctx.suppliers["PINT-REC"])
    .bind(lot_thi_02)
    .execute(&mut *tx)
    .await?;

    // Electrodo 6013 lots (3) — baseline approved, pending in Recepción, and
    // a small approved reserve lot. The third row keeps total distinct
    // products at 6 (consumables only) while landing on 15 lots total.
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes, purchase_order_line_id)
         VALUES
             ($1, $2, 'LOT-ELE-6013-01', (CURRENT_DATE - INTERVAL '30 days')::date, (CURRENT_DATE + INTERVAL '700 days')::date, $3, 12, 'approved', 'Electrodos 6013 estándar', NULL),
             ($4, $2, 'LOT-ELE-6013-02', (CURRENT_DATE - INTERVAL '3 days')::date,  (CURRENT_DATE + INTERVAL '730 days')::date, $3, 5,  'pending',  'Pendiente inspección de calidad', $5),
             ($6, $2, 'LOT-ELE-6013-03', (CURRENT_DATE - INTERVAL '90 days')::date, (CURRENT_DATE + INTERVAL '640 days')::date, $3, 4,  'approved', 'Reserva de electrodo 6013', NULL)",
    )
    .bind(lot_ele6013_01).bind(ctx.products["ELE-6013"]).bind(ctx.suppliers["SOLD-NORTE"])
    .bind(lot_ele6013_02).bind(po_101_ele_6013_line)
    .bind(lot_ele6013_03)
    .execute(&mut *tx)
    .await?;

    // Electrodo 7018 lots (2) — LOT-ELE-7018-02 tied to OC-2026-104 with near-exp date.
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes, purchase_order_line_id)
         VALUES
             ($1, $2, 'LOT-ELE-7018-01', (CURRENT_DATE - INTERVAL '20 days')::date, (CURRENT_DATE + INTERVAL '600 days')::date, $3, 8, 'approved', 'Entrada OC-2026-104 — lote aprobado', $4),
             ($5, $2, 'LOT-ELE-7018-02', (CURRENT_DATE - INTERVAL '1 days')::date,  (CURRENT_DATE + INTERVAL '25 days')::date,  $3, 4, 'pending',  'Recepción reciente — pendiente QC', NULL)",
    )
    .bind(lot_ele7018_01).bind(ctx.products["ELE-7018"]).bind(ctx.suppliers["FERR-IND-MX"])
    .bind(po_104_ele_7018_line).bind(lot_ele7018_02)
    .execute(&mut *tx)
    .await?;

    // Gas argón lots (2) — no expiration on tanks.
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes, purchase_order_line_id)
         VALUES
             ($1, $2, 'LOT-GAS-2026-01', (CURRENT_DATE - INTERVAL '40 days')::date, NULL, $3, 3, 'approved', 'Tanques llenos en zona de soldadura', NULL),
             ($4, $2, 'LOT-GAS-2026-02', (CURRENT_DATE - INTERVAL '2 days')::date,  NULL, $3, 1, 'pending',  'Tanque sin inspección — en Recepción', $5)",
    )
    .bind(lot_gas_01).bind(ctx.products["GAS-ARG"]).bind(ctx.suppliers["SOLD-NORTE"])
    .bind(lot_gas_02).bind(po_101_gas_line)
    .execute(&mut *tx)
    .await?;

    // Lámina lots (3).
    sqlx::query(
        "INSERT INTO product_lots
             (id, product_id, lot_number, batch_date, expiration_date, supplier_id, received_quantity, quality_status, notes, purchase_order_line_id)
         VALUES
             ($1, $2, 'LOT-LAM-2026-01', (CURRENT_DATE - INTERVAL '25 days')::date, NULL, $3, 10, 'approved', 'Láminas cal 14 stock general', NULL),
             ($4, $2, 'LOT-LAM-2026-02', (CURRENT_DATE - INTERVAL '1 days')::date,  NULL, $3, 5,  'approved', 'Lote OC-2026-103 (parcial) — en Recepción', $5),
             ($6, $2, 'LOT-LAM-2026-03', (CURRENT_DATE - INTERVAL '60 days')::date, NULL, $3, 3,  'rejected', 'Lote rechazado por deformación', NULL)",
    )
    .bind(lot_lam_01).bind(ctx.products["LAM-C14"]).bind(ctx.suppliers["ACEROS-MTY"])
    .bind(lot_lam_02).bind(po_103_lam_line).bind(lot_lam_03)
    .execute(&mut *tx)
    .await?;

    // ── inventory_lots (17 rows) ─────────────────────────────────────
    // SUM per lot matches received_quantity EXCEPT in-Recepción lots, which
    // are intentionally left sitting at Recepción until the distribute flow
    // runs in the UI.
    let bod_gen = ctx.locations["BOD-GENERAL"];
    let herr = ctx.locations["HERRAMIENTAS"];
    let zona_sold = ctx.locations["ZONA-SOLDADURA"];
    let rack_b = ctx.locations["RACK-B"];
    let bod_sobr = ctx.locations["BOD-SOBRANTE"];
    let rcp_alm = ctx.locations["RCP-ALM"];

    sqlx::query(
        "INSERT INTO inventory_lots (product_lot_id, location_id, quantity) VALUES
             ($1,  $22, 10),
             ($2,  $22, 5),
             ($2,  $23, 3),
             ($3,  $22, 2),
             ($4,  $22, 15),
             ($5,  $22, 10),
             ($6,  $24, 12),
             ($7,  $27, 5),
             ($8,  $24, 8),
             ($9,  $27, 4),
             ($10, $24, 3),
             ($11, $27, 1),
             ($12, $25, 7),
             ($12, $26, 3),
             ($13, $27, 5),
             ($14, $26, 3),
             ($15, $24, 4)",
    )
    .bind(lot_pin_01)      // $1
    .bind(lot_pin_02)      // $2
    .bind(lot_pin_03)      // $3
    .bind(lot_thi_01)      // $4
    .bind(lot_thi_02)      // $5
    .bind(lot_ele6013_01)  // $6
    .bind(lot_ele6013_02)  // $7
    .bind(lot_ele7018_01)  // $8
    .bind(lot_ele7018_02)  // $9
    .bind(lot_gas_01)      // $10
    .bind(lot_gas_02)      // $11
    .bind(lot_lam_01)      // $12
    .bind(lot_lam_02)      // $13
    .bind(lot_lam_03)      // $14
    .bind(lot_ele6013_03)  // $15
    .bind(Option::<Uuid>::None) // $16 placeholder (not used)
    .bind(Option::<Uuid>::None) // $17
    .bind(Option::<Uuid>::None) // $18
    .bind(Option::<Uuid>::None) // $19
    .bind(Option::<Uuid>::None) // $20
    .bind(Option::<Uuid>::None) // $21
    .bind(bod_gen)    // $22
    .bind(herr)       // $23
    .bind(zona_sold)  // $24
    .bind(rack_b)     // $25
    .bind(bod_sobr)   // $26
    .bind(rcp_alm)    // $27
    .execute(&mut *tx)
    .await?;

    // ── Reconcile `inventory` table with the new lot distribution ────
    // Post-lot product-location aggregate quantities. These UPSERTs make the
    // product-level view match the sum of inventory_lots at each location.
    // (Products without lots keep whatever `seed_core` set.)
    sqlx::query(
        "INSERT INTO inventory (product_id, location_id, quantity) VALUES
             ($1, $7,  17),   -- PIN-ANT-R @ BOD-GENERAL = 10 + 5 + 2
             ($1, $8,  3),    -- PIN-ANT-R @ HERRAMIENTAS
             ($2, $7,  25),   -- THI-STD   @ BOD-GENERAL = 15 + 10
             ($3, $9,  16),   -- ELE-6013  @ ZONA-SOLDADURA = 12 + 4
             ($3, $12, 5),    -- ELE-6013  @ RCP-ALM
             ($4, $9,  8),    -- ELE-7018  @ ZONA-SOLDADURA
             ($4, $12, 4),    -- ELE-7018  @ RCP-ALM
             ($5, $9,  3),    -- GAS-ARG   @ ZONA-SOLDADURA
             ($5, $12, 1),    -- GAS-ARG   @ RCP-ALM
             ($6, $10, 7),    -- LAM-C14   @ RACK-B
             ($6, $11, 3),    -- LAM-C14   @ BOD-SOBRANTE
             ($6, $12, 5)     -- LAM-C14   @ RCP-ALM
         ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity",
    )
    .bind(ctx.products["PIN-ANT-R"])  // $1
    .bind(ctx.products["THI-STD"])    // $2
    .bind(ctx.products["ELE-6013"])   // $3
    .bind(ctx.products["ELE-7018"])   // $4
    .bind(ctx.products["GAS-ARG"])    // $5
    .bind(ctx.products["LAM-C14"])    // $6
    .bind(bod_gen)    // $7
    .bind(herr)       // $8
    .bind(zona_sold)  // $9
    .bind(rack_b)     // $10
    .bind(bod_sobr)   // $11
    .bind(rcp_alm)    // $12
    .execute(&mut *tx)
    .await?;

    // ── Entry movements into Recepción (M21–M24) ────────────────────
    // Each row documents the arrival that left a lot sitting in Recepción.
    sqlx::query(
        "INSERT INTO movements
             (product_id, from_location_id, to_location_id, quantity, movement_type,
              user_id, reference, notes, movement_reason, created_at)
         VALUES
             ($1, NULL, $6, 5, 'entry', $7, 'OC-2026-101', 'Recepción electrodo 6013 (LOT-ELE-6013-02)', 'purchase_receive', NOW() - INTERVAL '3 days'),
             ($2, NULL, $6, 4, 'entry', $7, NULL,          'Recepción electrodo 7018 (LOT-ELE-7018-02)', 'purchase_receive', NOW() - INTERVAL '1 days'),
             ($3, NULL, $6, 1, 'entry', $7, 'OC-2026-101', 'Recepción tanque argón (LOT-GAS-2026-02)',  'purchase_receive', NOW() - INTERVAL '2 days'),
             ($4, NULL, $6, 5, 'entry', $7, 'OC-2026-103', 'Recepción lámina cal 14 (LOT-LAM-2026-02)', 'purchase_receive', NOW() - INTERVAL '1 days')",
    )
    .bind(ctx.products["ELE-6013"])   // $1
    .bind(ctx.products["ELE-7018"])   // $2
    .bind(ctx.products["GAS-ARG"])    // $3
    .bind(ctx.products["LAM-C14"])    // $4
    .bind(Option::<Uuid>::None)       // $5 filler
    .bind(rcp_alm)                    // $6
    .bind(admin)                      // $7
    .execute(&mut *tx)
    .await?;

    // ── Transfer movements (M25–M27) ────────────────────────────────
    // Distribution pairs — two relocation moves plus one Recepción→rack
    // distribution that completes the full receiving flow demanded by the
    // spec: ELE-6013 RCP-ALM → ZONA-SOLDADURA splits LOT-ELE-6013-02 across
    // two locations (3 remaining in Recepción, 2 already on the rack).
    sqlx::query(
        "INSERT INTO movements
             (product_id, from_location_id, to_location_id, quantity, movement_type,
              user_id, reference, notes, movement_reason, created_at)
         VALUES
             ($1, $4, $5, 3, 'transfer', $6, NULL,          'Redistribución interna de pintura',              'relocation', NOW() - INTERVAL '4 hours'),
             ($2, $7, $8, 3, 'transfer', $6, NULL,          'Sobrante de lámina a bodega sur',                'relocation', NOW() - INTERVAL '2 hours'),
             ($3, $9, $10, 2, 'transfer', $6, 'OC-2026-101', 'Distribución desde Recepción a zona de soldadura', 'relocation', NOW() - INTERVAL '1 hours')",
    )
    .bind(ctx.products["PIN-ANT-R"])  // $1
    .bind(ctx.products["LAM-C14"])    // $2
    .bind(ctx.products["ELE-6013"])   // $3
    .bind(bod_gen)     // $4 from (PIN-ANT-R)
    .bind(herr)        // $5 to   (PIN-ANT-R)
    .bind(admin)       // $6
    .bind(rack_b)      // $7 from (LAM-C14)
    .bind(bod_sobr)    // $8 to   (LAM-C14)
    .bind(rcp_alm)     // $9 from (ELE-6013 — Recepción)
    .bind(zona_sold)   // $10 to   (ELE-6013 — rack final)
    .execute(&mut *tx)
    .await?;

    // Split LOT-ELE-6013-02 across RCP-ALM (3) and ZONA-SOLDADURA (2) so the
    // lot sum still equals its received_quantity (5). Existing row @ RCP-ALM
    // is updated via the UNIQUE(product_lot_id, location_id) clause.
    sqlx::query(
        "UPDATE inventory_lots SET quantity = 3
         WHERE product_lot_id = $1 AND location_id = $2",
    )
    .bind(lot_ele6013_02)
    .bind(rcp_alm)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO inventory_lots (product_lot_id, location_id, quantity)
         VALUES ($1, $2, 2)
         ON CONFLICT (product_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity",
    )
    .bind(lot_ele6013_02)
    .bind(zona_sold)
    .execute(&mut *tx)
    .await?;

    // Apply inventory deltas for all three transfers so the product-level
    // view matches the net effect.
    sqlx::query(
        "INSERT INTO inventory (product_id, location_id, quantity) VALUES
             ($1, $4, 14),   -- PIN-ANT-R @ BOD-GENERAL = 17 - 3
             ($1, $5, 6),    -- PIN-ANT-R @ HERRAMIENTAS = 3 + 3
             ($2, $6, 4),    -- LAM-C14   @ RACK-B = 7 - 3
             ($2, $7, 6),    -- LAM-C14   @ BOD-SOBRANTE = 3 + 3
             ($3, $8, 3),    -- ELE-6013  @ RCP-ALM = 5 - 2
             ($3, $9, 18)    -- ELE-6013  @ ZONA-SOLDADURA = 16 + 2
         ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity",
    )
    .bind(ctx.products["PIN-ANT-R"])  // $1
    .bind(ctx.products["LAM-C14"])    // $2
    .bind(ctx.products["ELE-6013"])   // $3
    .bind(bod_gen)     // $4
    .bind(herr)        // $5
    .bind(rack_b)      // $6
    .bind(bod_sobr)    // $7
    .bind(rcp_alm)     // $8
    .bind(zona_sold)   // $9
    .execute(&mut *tx)
    .await?;

    Ok(())
}

// ── Phase 3 ─ Purchase Returns ────────────────────────────────────────
//
// Seeds 2 purchase returns covering both active statuses: DEV-2026-001 is
// shipped_to_supplier with a damaged-reason partial return (1 item) and
// triggers an `exit` movement from HERRAMIENTAS plus an inventory decrement.
// DEV-2026-002 is pending with a defective-reason single item, no movement
// yet. Totals are UPDATEd from item subtotals after the items are inserted.
async fn seed_purchase_returns(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let admin = ctx.users["admin@vandev.mx"];

    // Resolve PO UUIDs by order_number.
    let po_104 = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM purchase_orders WHERE order_number = 'OC-2026-104'",
    )
    .fetch_one(&mut *tx)
    .await?;
    let po_103 = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM purchase_orders WHERE order_number = 'OC-2026-103'",
    )
    .fetch_one(&mut *tx)
    .await?;

    let ret_001 = Uuid::new_v4();
    let ret_002 = Uuid::new_v4();

    // Return headers — subtotal/total filled after items.
    sqlx::query(
        "INSERT INTO purchase_returns
             (id, purchase_order_id, return_number, status, reason, reason_notes,
              subtotal, total, decrease_inventory, requested_by_id, shipped_at, created_at)
         VALUES
             ($1, $2, 'DEV-2026-001', 'shipped_to_supplier', 'damaged',   'Discos dañados en el empaque',        0, 0, TRUE,  $4, NOW() - INTERVAL '2 days', NOW() - INTERVAL '3 days'),
             ($3, $5, 'DEV-2026-002', 'pending',             'defective', 'Tubos con defecto de fabricación',    0, 0, FALSE, $4, NULL,                      NOW() - INTERVAL '1 days')",
    )
    .bind(ret_001).bind(po_104)
    .bind(ret_002).bind(admin).bind(po_103)
    .execute(&mut *tx)
    .await?;

    // Items for DEV-2026-001 (shipped)
    sqlx::query(
        "INSERT INTO purchase_return_items
             (purchase_return_id, product_id, quantity_returned, quantity_original, unit_price, subtotal)
         VALUES ($1, $2, 3, 30, 55.00, 165.00)",
    )
    .bind(ret_001).bind(ctx.products["DIS-DES-7"])
    .execute(&mut *tx)
    .await?;

    // Items for DEV-2026-002 (pending)
    sqlx::query(
        "INSERT INTO purchase_return_items
             (purchase_return_id, product_id, quantity_returned, quantity_original, unit_price, subtotal)
         VALUES ($1, $2, 2, 40, 160.00, 320.00)",
    )
    .bind(ret_002).bind(ctx.products["TUB-CUA-1"])
    .execute(&mut *tx)
    .await?;

    // UPDATE subtotal/total for both returns (no tax — demo).
    for ret_id in [ret_001, ret_002] {
        sqlx::query(
            "UPDATE purchase_returns
             SET subtotal = (
                 SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items WHERE purchase_return_id = $1
             ),
                 total = (
                 SELECT COALESCE(SUM(subtotal), 0) FROM purchase_return_items WHERE purchase_return_id = $1
             )
             WHERE id = $1",
        )
        .bind(ret_id)
        .execute(&mut *tx)
        .await?;
    }

    // Exit movement + inventory decrement for the shipped return.
    let herr = ctx.locations["HERRAMIENTAS"];
    sqlx::query(
        "INSERT INTO movements
             (product_id, from_location_id, to_location_id, quantity, movement_type,
              user_id, reference, notes, movement_reason, created_at)
         VALUES ($1, $2, NULL, 3, 'exit', $3, 'DEV-2026-001', 'Devolución a proveedor — discos dañados', 'return_to_supplier', NOW() - INTERVAL '2 days')",
    )
    .bind(ctx.products["DIS-DES-7"])
    .bind(herr)
    .bind(admin)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE inventory SET quantity = quantity - 3
         WHERE product_id = $1 AND location_id = $2",
    )
    .bind(ctx.products["DIS-DES-7"])
    .bind(herr)
    .execute(&mut *tx)
    .await?;

    Ok(())
}

// ── Phase 4 ─ Stock Alert Tuning ──────────────────────────────────────
//
// Drives the alerts query (`alerts_repo::get_stock_alerts`) to return EXACTLY
// 4 rows post-seed. Severity buckets per the repo:
//   critical: i.quantity = 0
//   low:      i.quantity > 0 AND i.quantity <= min_stock * 0.5
//   warning:  i.quantity > min_stock * 0.5 AND i.quantity <= min_stock
//
// Target rows:
//   GAS-ARG   @ RCP-ALM        qty=1, min=1  → warning
//   DIS-DES-7 @ HERRAMIENTAS   qty=2, min=5  → low      (was 4, now 1 after return; set back to 2)
//   ELE-7018  @ ZONA-SOLDADURA qty=1, min=3  → low
//   THI-STD   @ BOD-GENERAL    qty=0, min=5  → critical
//
// To keep only these 4 alerted, the helper ALSO lowers `min_stock` on a small
// set of products (DIS-COR-7, BIS-IND-4, LAM-C14, ELE-6013) whose inventory
// would otherwise sit at/below the pre-existing `min_stock`. Values chosen so
// every non-target product's min_stock falls strictly below its smallest
// stocked quantity.
async fn seed_stock_alert_tuning(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    // Lower min_stock on products that would otherwise produce false-positive
    // alerts after Phase 2/3. See module comment above for derivation.
    sqlx::query("UPDATE products SET min_stock = 5 WHERE id = $1")
        .bind(ctx.products["DIS-COR-7"])
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE products SET min_stock = 10 WHERE id = $1")
        .bind(ctx.products["BIS-IND-4"])
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE products SET min_stock = 2 WHERE id = $1")
        .bind(ctx.products["LAM-C14"])
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE products SET min_stock = 2 WHERE id = $1")
        .bind(ctx.products["ELE-6013"])
        .execute(&mut *tx).await?;

    // Now tune inventory for the 4 target alerted products.
    // DIS-DES-7 @ HERRAMIENTAS: was 4 before return, now 1 after exit movement.
    // We bump it back to 2 so it sits in the `low` bucket (qty > 0, ≤ min*0.5=2.5).
    sqlx::query(
        "UPDATE inventory SET quantity = 2
         WHERE product_id = $1 AND location_id = $2",
    )
    .bind(ctx.products["DIS-DES-7"])
    .bind(ctx.locations["HERRAMIENTAS"])
    .execute(&mut *tx).await?;

    // ELE-7018 @ ZONA-SOLDADURA: 8 → 1, lands in `low` bucket (1 ≤ 3*0.5=1.5).
    sqlx::query(
        "UPDATE inventory SET quantity = 1
         WHERE product_id = $1 AND location_id = $2",
    )
    .bind(ctx.products["ELE-7018"])
    .bind(ctx.locations["ZONA-SOLDADURA"])
    .execute(&mut *tx).await?;

    // THI-STD @ BOD-GENERAL: 25 → 0, lands in `critical` bucket.
    sqlx::query(
        "UPDATE inventory SET quantity = 0
         WHERE product_id = $1 AND location_id = $2",
    )
    .bind(ctx.products["THI-STD"])
    .bind(ctx.locations["BOD-GENERAL"])
    .execute(&mut *tx).await?;

    // GAS-ARG keeps min_stock=1 (initial seed) and @ RCP-ALM qty=1 (from
    // inventory_lots sync in Phase 2). 1 ≤ 1 AND 1 > 0.5 → warning. No UPDATE
    // needed.

    Ok(())
}

// ── Phase 5 ─ Cycle Counts ────────────────────────────────────────────
//
// Seeds 2 cycle counts: CC-01 completed at Almacén Principal with 6 items
// (4 non-zero variances), CC-02 in_progress at Bodega Sur with 6 items and
// only 2 counted. Items are inserted EXPLICITLY with system_quantity matching
// the actual inventory at count time — this gives deterministic variance
// numbers without depending on INSERT..SELECT ordering.
async fn seed_cycle_counts(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let carlos = ctx.users["carlos@vandev.mx"];
    let laura = ctx.users["laura@vandev.mx"];

    let cc_01 = Uuid::new_v4();
    let cc_02 = Uuid::new_v4();

    // Cycle count sessions.
    sqlx::query(
        "INSERT INTO cycle_counts (id, warehouse_id, name, status, created_by, completed_at, notes, created_at)
         VALUES
             ($1, $2, 'CC-01 Almacén Principal', 'completed',   $3, NOW() - INTERVAL '5 days', 'Conteo mensual cerrado',  NOW() - INTERVAL '6 days'),
             ($4, $5, 'CC-02 Bodega Sur',        'in_progress', $6, NULL,                      'Conteo en curso',         NOW() - INTERVAL '1 days')",
    )
    .bind(cc_01).bind(ctx.warehouses["ALM"]).bind(carlos)
    .bind(cc_02).bind(ctx.warehouses["BOD"]).bind(laura)
    .execute(&mut *tx)
    .await?;

    // CC-01 items (6 — 4 non-zero variances).
    let rack_a = ctx.locations["RACK-A"];
    let rack_b = ctx.locations["RACK-B"];
    let zona_sold = ctx.locations["ZONA-SOLDADURA"];

    sqlx::query(
        "INSERT INTO cycle_count_items
             (cycle_count_id, product_id, location_id, system_quantity, counted_quantity, variance, counted_by, counted_at)
         VALUES
             ($1, $2, $3, 45, 45,  0, $9, NOW() - INTERVAL '5 days'),
             ($1, $4, $3, 30, 28, -2, $9, NOW() - INTERVAL '5 days'),
             ($1, $5, $3, 25, 25,  0, $9, NOW() - INTERVAL '5 days'),
             ($1, $6, $7, 35, 37,  2, $9, NOW() - INTERVAL '5 days'),
             ($1, $8, $7, 10,  8, -2, $9, NOW() - INTERVAL '5 days'),
             ($1, $10, $11, 18, 17, -1, $9, NOW() - INTERVAL '5 days')",
    )
    .bind(cc_01)
    .bind(ctx.products["TUB-RED-2"])   // $2
    .bind(rack_a)                      // $3
    .bind(ctx.products["TUB-CUA-1"])   // $4
    .bind(ctx.products["PTR-2X2"])     // $5
    .bind(ctx.products["ANG-1-18"])    // $6
    .bind(rack_b)                      // $7
    .bind(ctx.products["LAM-C14"])     // $8
    .bind(carlos)                      // $9
    .bind(ctx.products["ELE-6013"])    // $10
    .bind(zona_sold)                   // $11
    .execute(&mut *tx)
    .await?;

    // CC-02 items (6 — 2 counted, 4 pending).
    let bod_gen = ctx.locations["BOD-GENERAL"];
    let bod_sobr = ctx.locations["BOD-SOBRANTE"];
    let herr = ctx.locations["HERRAMIENTAS"];

    sqlx::query(
        "INSERT INTO cycle_count_items
             (cycle_count_id, product_id, location_id, system_quantity, counted_quantity, variance, counted_by, counted_at)
         VALUES
             ($1, $2, $3, 14,  17,  3, $9, NOW() - INTERVAL '4 hours'),
             ($1, $4, $3, 500, 498, -2, $9, NOW() - INTERVAL '3 hours'),
             ($1, $5, $3, 0,   NULL, NULL, NULL, NULL),
             ($1, $6, $3, 15,  NULL, NULL, NULL, NULL),
             ($1, $7, $8, 6,   NULL, NULL, NULL, NULL),
             ($1, $10, $11, 2,  NULL, NULL, NULL, NULL)",
    )
    .bind(cc_02)
    .bind(ctx.products["PIN-ANT-R"])  // $2
    .bind(bod_gen)                    // $3
    .bind(ctx.products["TOR-14-1"])   // $4
    .bind(ctx.products["THI-STD"])    // $5
    .bind(ctx.products["BIS-IND-4"])  // $6
    .bind(ctx.products["LAM-C14"])    // $7
    .bind(bod_sobr)                   // $8
    .bind(laura)                      // $9
    .bind(ctx.products["DIS-DES-7"])  // $10
    .bind(herr)                       // $11
    .execute(&mut *tx)
    .await?;

    Ok(())
}

// ── Phase 6 ─ Recipes (BOM) ───────────────────────────────────────────
//
// Seeds 3 recipes with deterministic item counts: REC-01 (Puerta herrería
// básica) 6 items, REC-02 (Rejilla ventana estándar) 3 items, REC-03 (Repisa
// metálica) 4 items. Total 13 recipe_items. All active, not deleted.
async fn seed_recipes(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let carlos = ctx.users["carlos@vandev.mx"];
    let miguel = ctx.users["miguel@vandev.mx"];

    let rec_01 = Uuid::new_v4();
    let rec_02 = Uuid::new_v4();
    let rec_03 = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO recipes (id, name, description, created_by, is_active)
         VALUES
             ($1, 'Puerta herrería básica',   'Receta base de puerta de herrería estándar 1 × 2.10 m', $2, TRUE),
             ($3, 'Rejilla ventana estándar', 'Rejilla de seguridad para ventana de 1 m²',            $2, TRUE),
             ($4, 'Repisa metálica',          'Repisa de acero para taller — 60 × 120 cm',            $5, TRUE)",
    )
    .bind(rec_01)
    .bind(carlos)
    .bind(rec_02)
    .bind(rec_03)
    .bind(miguel)
    .execute(&mut *tx)
    .await?;

    // REC-01 items (6)
    sqlx::query(
        "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes) VALUES
             ($1, $2, 6,    'Marco perimetral'),
             ($1, $3, 4,    'Refuerzos internos'),
             ($1, $4, 2,    'Refuerzo de bisagras'),
             ($1, $5, 2,    NULL),
             ($1, $6, 0.5,  NULL),
             ($1, $7, 0.25, 'Acabado anticorrosivo')",
    )
    .bind(rec_01)
    .bind(ctx.products["TUB-RED-2"])
    .bind(ctx.products["TUB-CUA-1"])
    .bind(ctx.products["SOL-1-14"])
    .bind(ctx.products["BIS-IND-4"])
    .bind(ctx.products["ELE-6013"])
    .bind(ctx.products["PIN-ANT-R"])
    .execute(&mut *tx)
    .await?;

    // REC-02 items (3)
    sqlx::query(
        "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes) VALUES
             ($1, $2, 8,   'Barras verticales y horizontales'),
             ($1, $3, 0.3, NULL),
             ($1, $4, 0.1, 'Acabado')",
    )
    .bind(rec_02)
    .bind(ctx.products["SOL-1-14"])
    .bind(ctx.products["ELE-6013"])
    .bind(ctx.products["PIN-ANT-R"])
    .execute(&mut *tx)
    .await?;

    // REC-03 items (4)
    sqlx::query(
        "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes) VALUES
             ($1, $2, 1,   'Tapa superior'),
             ($1, $3, 4,   'Patas en ángulo'),
             ($1, $4, 8,   'Tornillos de fijación'),
             ($1, $5, 0.2, NULL)",
    )
    .bind(rec_03)
    .bind(ctx.products["LAM-C14"])
    .bind(ctx.products["ANG-1-18"])
    .bind(ctx.products["TOR-14-1"])
    .bind(ctx.products["PIN-ANT-R"])
    .execute(&mut *tx)
    .await?;

    Ok(())
}

// ── Phase 7 ─ Notifications ───────────────────────────────────────────
//
// Seeds 8 notifications across 4 demo users: 4 stock-related (matches the
// alerts produced by Phase 4), 1 cycle_count_due referencing CC-02, and 3
// system notifications (2 welcome messages + 1 backup notice). Only the
// miguel welcome notification is pre-read. Every row has a non-null dedup_key
// unique per (user_id, dedup_key) so a second seed run is a no-op under the
// existing partial unique index.
async fn seed_notifications(
    tx: &mut PgConnection,
    ctx: &SeedContext,
) -> Result<()> {
    let admin = ctx.users["admin@vandev.mx"];
    let carlos = ctx.users["carlos@vandev.mx"];
    let miguel = ctx.users["miguel@vandev.mx"];
    let laura = ctx.users["laura@vandev.mx"];

    // Resolve the CC-02 id (for the cycle_count_due notification).
    let cc_02 = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM cycle_counts WHERE name = 'CC-02 Bodega Sur'",
    )
    .fetch_one(&mut *tx)
    .await?;

    let thi = ctx.products["THI-STD"];
    let ele7018 = ctx.products["ELE-7018"];
    let disd = ctx.products["DIS-DES-7"];
    let gas = ctx.products["GAS-ARG"];

    // Stock-family notifications (4).
    sqlx::query(
        "INSERT INTO notifications
             (user_id, notification_type, title, body, is_read, reference_id, reference_type, dedup_key, created_at)
         VALUES
             ($1, 'stock_critical', 'Thinner agotado',               'Thinner sin stock en Bodega Sur — re-orden urgente', FALSE, $2, 'product', $3, NOW() - INTERVAL '2 hours'),
             ($1, 'stock_low',      'Electrodo 7018 bajo',           'Electrodo 7018 en nivel bajo en Zona de Soldadura (1 kg restante)', FALSE, $4, 'product', $5, NOW() - INTERVAL '3 hours'),
             ($6, 'stock_low',      'Disco de desbaste bajo',        'Discos de desbaste en nivel bajo tras devolución (2 piezas)',       FALSE, $7, 'product', $8, NOW() - INTERVAL '4 hours'),
             ($6, 'stock_warning',  'Gas argón en nivel mínimo',     'Un tanque de argón restante en Recepción — revisar OC-2026-101',    FALSE, $9, 'product', $10, NOW() - INTERVAL '5 hours')",
    )
    .bind(admin)                              // $1
    .bind(thi)                                // $2
    .bind(format!("stock-critical-{thi}"))    // $3
    .bind(ele7018)                            // $4
    .bind(format!("stock-low-{ele7018}"))     // $5
    .bind(carlos)                             // $6
    .bind(disd)                               // $7
    .bind(format!("stock-low-{disd}"))        // $8
    .bind(gas)                                // $9
    .bind(format!("stock-warning-{gas}"))     // $10
    .execute(&mut *tx)
    .await?;

    // Cycle count due (1).
    sqlx::query(
        "INSERT INTO notifications
             (user_id, notification_type, title, body, is_read, reference_id, reference_type, dedup_key, created_at)
         VALUES ($1, 'cycle_count_due', 'Conteo pendiente en Bodega Sur', 'El conteo CC-02 en Bodega Sur sigue en progreso — 4 ítems por contar', FALSE, $2, 'cycle_count', 'cc-due-cc02', NOW() - INTERVAL '1 hours')",
    )
    .bind(carlos)
    .bind(cc_02)
    .execute(&mut *tx)
    .await?;

    // System notifications (3).
    sqlx::query(
        "INSERT INTO notifications
             (user_id, notification_type, title, body, is_read, reference_id, reference_type, dedup_key, created_at, read_at)
         VALUES
             ($1, 'system', 'Bienvenido a VanFlow',         'Hola Miguel, revisa tu dashboard y el inventario de la semana', TRUE,  NULL, NULL, 'sys-welcome-miguel', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 days'),
             ($2, 'system', 'Bienvenido a VanFlow',         'Hola Laura, revisa tu dashboard y el inventario de la semana',  FALSE, NULL, NULL, 'sys-welcome-laura',  NOW() - INTERVAL '3 days', NULL),
             ($3, 'system', 'Mantenimiento programado',     'Backup nocturno de la base de datos completado correctamente', FALSE, NULL, NULL, $4,                   NOW() - INTERVAL '30 minutes', NULL)",
    )
    .bind(miguel)
    .bind(laura)
    .bind(admin)
    .bind(format!("sys-backup-{}", chrono::Utc::now().format("%Y%m%d")))
    .execute(&mut *tx)
    .await?;

    Ok(())
}

// ── Phase 5 ─ Work Orders & BOM demo fixture ──────────────────────────
//
// Idempotent, self-contained top-level helper. Runs AFTER `seed_demo_data`
// (called from main.rs). Every INSERT is guarded by a natural key or
// `NOT EXISTS` pre-check so re-running the seed adds zero rows to any of
// the touched tables (locations, products, recipe_items, work_orders,
// work_order_materials, movements, product_lots, inventory_lots, inventory).
//
// Unlike `seed_demo_data`, this helper does NOT bail on a populated DB —
// its per-section guards handle re-entry. The "seed-in-isolation" case
// (test DB restored without migrations) also ends up in the expected
// state via the 5.1 backfill duplicating Migration 3.
//
// Sections:
//   5.1 — finished_good system location per non-deleted warehouse (duplicates
//         the 20260423000003 migration backfill; harmless when both run).
//   5.2 — 1–2 `work_center` system locations in `Almacén Principal`.
//   5.3 — manufacturable raw_material SKU `PUE-HER-BAS`.
//   5.4 — ensure REC-01 (`Puerta herrería básica`) has ≥3 `recipe_items`.
//         The existing `seed_recipes` already inserts 6 items; this is a
//         belt-and-suspenders check for the seed-in-isolation case.
//   5.5 — 2 demo work orders: WO-DEMO-01 (draft, no movements),
//         WO-DEMO-02 (completed, full back-flush chain + FG lot + FG
//         inventory).
pub async fn seed_work_orders_demo(pool: &PgPool) -> Result<()> {
    let mut tx = pool.begin().await?;

    // Resolve shared IDs used across sections. The seed is ordered so
    // these must exist by the time this helper runs; if the DB is missing
    // `Almacén Principal`, we skip 5.2/5.5 and still do 5.1 + 5.3 + 5.4.
    let almacen_principal_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM warehouses WHERE name = 'Almacén Principal' LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;

    let admin_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1",
    )
    .fetch_one(&mut *tx)
    .await?;

    // ── 5.1 ─ Finished-good system location per warehouse ────────────
    // Duplicates migration 20260423000003's backfill so a fresh test DB
    // (e.g. restored without running migrations) still lands in the
    // expected state. The partial unique index
    // `idx_one_finished_good_per_warehouse` guarantees ≤1 row per
    // warehouse; NOT EXISTS makes the INSERT idempotent.
    sqlx::query(
        "INSERT INTO locations
             (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
         SELECT w.id, 'finished_good', 'Producto Terminado', 'PT', TRUE, 0, 0, 100, 100
         FROM warehouses w
         WHERE NOT EXISTS (
             SELECT 1 FROM locations l
             WHERE l.warehouse_id = w.id
               AND l.location_type = 'finished_good'
               AND l.is_system = TRUE
         )",
    )
    .execute(&mut *tx)
    .await?;

    // If there's no Almacén Principal we can't do 5.2 or 5.5. 5.3/5.4 still
    // run since they're warehouse-independent.
    let Some(almacen_principal_id) = almacen_principal_id else {
        info!("seed_work_orders_demo: Almacén Principal not found — completed 5.1 only");
        // Still run 5.3 and 5.4 (they don't depend on Almacén Principal).
        seed_phase5_product_and_recipe(&mut tx).await?;
        tx.commit().await?;
        return Ok(());
    };

    // ── 5.2 ─ Work-center locations in Almacén Principal ─────────────
    // Guard by (warehouse_id, name) pre-check. CHECK requires is_system=true.
    // Coordinates are stable so re-runs compare identically.
    for (name, label, pos_x, pos_y) in [
        ("Taller Principal", "T1", 600.0_f32, 400.0_f32),
        ("Taller Secundario", "T2", 820.0_f32, 400.0_f32),
    ] {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM locations
             WHERE warehouse_id = $1 AND name = $2 AND location_type = 'work_center'",
        )
        .bind(almacen_principal_id)
        .bind(name)
        .fetch_one(&mut *tx)
        .await?;

        if exists == 0 {
            sqlx::query(
                "INSERT INTO locations
                     (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
                 VALUES ($1, 'work_center', $2, $3, TRUE, $4, $5, 180, 160)",
            )
            .bind(almacen_principal_id)
            .bind(name)
            .bind(label)
            .bind(pos_x)
            .bind(pos_y)
            .execute(&mut *tx)
            .await?;
        }
    }

    // ── 5.3 + 5.4 ─ Product + REC-01 ingredients guard ───────────────
    seed_phase5_product_and_recipe(&mut tx).await?;

    // ── 5.5 ─ Demo Work Orders ───────────────────────────────────────
    // Pre-check WO-DEMO-01 existence. Because WO-DEMO-02 cascades into
    // movements/product_lots/inventory rows, gate the ENTIRE section on
    // the presence of both WO codes — if either is missing, do its
    // respective cascade; otherwise skip.
    let pue_her_bas_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM products WHERE sku = 'PUE-HER-BAS' LIMIT 1")
            .fetch_one(&mut *tx)
            .await?;

    let rec_01_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM recipes WHERE name = 'Puerta herrería básica' AND deleted_at IS NULL LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(rec_01_id) = rec_01_id else {
        info!("seed_work_orders_demo: REC-01 (Puerta herrería básica) missing — skipping 5.5");
        tx.commit().await?;
        return Ok(());
    };

    let taller_principal_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM locations
         WHERE warehouse_id = $1 AND name = 'Taller Principal' AND location_type = 'work_center'
         LIMIT 1",
    )
    .bind(almacen_principal_id)
    .fetch_one(&mut *tx)
    .await?;

    let producto_terminado_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM locations
         WHERE warehouse_id = $1 AND location_type = 'finished_good' AND is_system = TRUE
         LIMIT 1",
    )
    .bind(almacen_principal_id)
    .fetch_one(&mut *tx)
    .await?;

    // Materialize REC-01's items once — used for both WOs. Use ::float8 cast
    // to avoid pulling in bigdecimal/rust_decimal features for a single read.
    let recipe_items: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT product_id, quantity::float8 FROM recipe_items WHERE recipe_id = $1 ORDER BY created_at ASC",
    )
    .bind(rec_01_id)
    .fetch_all(&mut *tx)
    .await?;

    if recipe_items.is_empty() {
        info!("seed_work_orders_demo: REC-01 has no items — skipping WO-DEMO-01/02");
        tx.commit().await?;
        return Ok(());
    }

    // ── 5.5a ─ WO-DEMO-01 (draft, just header + material snapshot) ───
    let wo_01_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM work_orders WHERE code = 'WO-DEMO-01'",
    )
    .fetch_one(&mut *tx)
    .await?;

    if wo_01_exists == 0 {
        let wo_01_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO work_orders
                 (id, code, recipe_id, fg_product_id, fg_quantity, status,
                  warehouse_id, work_center_location_id, notes, created_by)
             VALUES ($1, 'WO-DEMO-01', $2, $3, 1, 'draft',
                     $4, $5, 'Orden demo en borrador (sin movimientos)', $6)",
        )
        .bind(wo_01_id)
        .bind(rec_01_id)
        .bind(pue_her_bas_id)
        .bind(almacen_principal_id)
        .bind(taller_principal_id)
        .bind(admin_id)
        .execute(&mut *tx)
        .await?;

        for (product_id, quantity) in &recipe_items {
            sqlx::query(
                "INSERT INTO work_order_materials
                     (work_order_id, product_id, quantity_expected, quantity_consumed)
                 VALUES ($1, $2, $3, 0)
                 ON CONFLICT (work_order_id, product_id) DO NOTHING",
            )
            .bind(wo_01_id)
            .bind(*product_id)
            .bind(*quantity)
            .execute(&mut *tx)
            .await?;
        }
    }

    // ── 5.5b ─ WO-DEMO-02 (completed, full back-flush chain) ─────────
    let wo_02_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM work_orders WHERE code = 'WO-DEMO-02'",
    )
    .fetch_one(&mut *tx)
    .await?;

    if wo_02_exists == 0 {
        // For each ingredient, resolve a source location in Almacén Principal
        // that holds inventory for that SKU. If none exists, top up the
        // HERRAMIENTAS zone with a small buffer so the issue transfer has a
        // source (documented deviation from design §3c which expects
        // pre-existing seed inventory). Design §13 Risk 5 calls this out.
        let herramientas_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM locations
             WHERE warehouse_id = $1 AND name = 'Herramientas' AND location_type = 'zone'
             LIMIT 1",
        )
        .bind(almacen_principal_id)
        .fetch_one(&mut *tx)
        .await?;

        let wo_02_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO work_orders
                 (id, code, recipe_id, fg_product_id, fg_quantity, status,
                  warehouse_id, work_center_location_id, notes, created_by,
                  created_at, issued_at, completed_at)
             VALUES ($1, 'WO-DEMO-02', $2, $3, 1, 'completed',
                     $4, $5, 'Orden demo completada (cadena back-flush sintetizada)', $6,
                     NOW() - INTERVAL '3 hours',
                     NOW() - INTERVAL '2 hours',
                     NOW() - INTERVAL '1 hour')",
        )
        .bind(wo_02_id)
        .bind(rec_01_id)
        .bind(pue_her_bas_id)
        .bind(almacen_principal_id)
        .bind(taller_principal_id)
        .bind(admin_id)
        .execute(&mut *tx)
        .await?;

        // Insert materials with full consumption; emit wo_issue + back_flush
        // movements per ingredient.
        for (product_id, quantity) in &recipe_items {
            let product_id = *product_id;
            let quantity = *quantity;
            sqlx::query(
                "INSERT INTO work_order_materials
                     (work_order_id, product_id, quantity_expected, quantity_consumed)
                 VALUES ($1, $2, $3, $3)
                 ON CONFLICT (work_order_id, product_id) DO NOTHING",
            )
            .bind(wo_02_id)
            .bind(product_id)
            .bind(quantity)
            .execute(&mut *tx)
            .await?;

            // Resolve a source storage location in Almacén Principal.
            // Skip reception/work_center/finished_good; prefer highest qty.
            let source_location = sqlx::query_scalar::<_, Uuid>(
                "SELECT i.location_id FROM inventory i
                 JOIN locations l ON l.id = i.location_id
                 WHERE i.product_id = $1
                   AND l.warehouse_id = $2
                   AND l.location_type NOT IN ('reception', 'work_center', 'finished_good')
                   AND i.quantity > 0
                 ORDER BY i.quantity DESC, l.created_at ASC
                 LIMIT 1",
            )
            .bind(product_id)
            .bind(almacen_principal_id)
            .fetch_optional(&mut *tx)
            .await?;

            let source_location = match source_location {
                Some(id) => id,
                None => {
                    // Top up HERRAMIENTAS with a small buffer so the issue
                    // transfer has a source (documented deviation from
                    // design §3c which expects pre-existing seed inventory;
                    // design §13 Risk 5). ON CONFLICT on the
                    // (product_id, location_id) unique index keeps the
                    // operation idempotent across re-runs.
                    sqlx::query(
                        "INSERT INTO inventory (product_id, location_id, quantity)
                         VALUES ($1, $2, 10)
                         ON CONFLICT (product_id, location_id) DO UPDATE
                             SET quantity = GREATEST(inventory.quantity, 10)",
                    )
                    .bind(product_id)
                    .bind(herramientas_id)
                    .execute(&mut *tx)
                    .await?;
                    herramientas_id
                }
            };

            // Emit wo_issue transfer movement (storage → work_center).
            sqlx::query(
                "INSERT INTO movements
                     (product_id, from_location_id, to_location_id, quantity,
                      movement_type, user_id, reference, notes, movement_reason,
                      work_order_id, created_at)
                 VALUES ($1, $2, $3, $4, 'transfer', $5, 'WO-DEMO-02', NULL,
                         'wo_issue', $6, NOW() - INTERVAL '2 hours')",
            )
            .bind(product_id)
            .bind(source_location)
            .bind(taller_principal_id)
            .bind(quantity)
            .bind(admin_id)
            .bind(wo_02_id)
            .execute(&mut *tx)
            .await?;

            // Emit back_flush exit movement (work_center → void).
            sqlx::query(
                "INSERT INTO movements
                     (product_id, from_location_id, to_location_id, quantity,
                      movement_type, user_id, reference, notes, movement_reason,
                      work_order_id, created_at)
                 VALUES ($1, $2, NULL, $3, 'exit', $4, 'WO-DEMO-02', NULL,
                         'back_flush', $5, NOW() - INTERVAL '1 hour')",
            )
            .bind(product_id)
            .bind(taller_principal_id)
            .bind(quantity)
            .bind(admin_id)
            .bind(wo_02_id)
            .execute(&mut *tx)
            .await?;
        }

        // Insert the FG product_lot using the lot_number format the WO
        // `complete` path generates: `WO-<code>-<YYYYMMDD>`, where the date
        // mirrors the completion timestamp.
        let fg_lot_id = Uuid::new_v4();
        let today = chrono::Utc::now().date_naive();
        let lot_number = format!("WO-WO-DEMO-02-{}", today.format("%Y%m%d"));
        sqlx::query(
            "INSERT INTO product_lots
                 (id, product_id, lot_number, batch_date, expiration_date,
                  received_quantity, quality_status, notes)
             VALUES ($1, $2, $3, $4, NULL, 1, 'pending',
                     'Lote generado por WO-DEMO-02 (seed)')
             ON CONFLICT (product_id, lot_number) DO NOTHING",
        )
        .bind(fg_lot_id)
        .bind(pue_her_bas_id)
        .bind(&lot_number)
        .bind(today)
        .execute(&mut *tx)
        .await?;

        // Re-fetch the FG lot ID in case ON CONFLICT skipped (idempotency
        // against partial-run state).
        let fg_lot_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM product_lots WHERE product_id = $1 AND lot_number = $2",
        )
        .bind(pue_her_bas_id)
        .bind(&lot_number)
        .fetch_one(&mut *tx)
        .await?;

        // inventory_lots + inventory rows for the FG at Producto Terminado.
        sqlx::query(
            "INSERT INTO inventory_lots (product_lot_id, location_id, quantity)
             VALUES ($1, $2, 1)
             ON CONFLICT (product_lot_id, location_id) DO NOTHING",
        )
        .bind(fg_lot_id)
        .bind(producto_terminado_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO inventory (product_id, location_id, quantity)
             VALUES ($1, $2, 1)
             ON CONFLICT (product_id, location_id) DO UPDATE
                 SET quantity = inventory.quantity + 1",
        )
        .bind(pue_her_bas_id)
        .bind(producto_terminado_id)
        .execute(&mut *tx)
        .await?;

        // production_output entry movement (void → finished_good).
        sqlx::query(
            "INSERT INTO movements
                 (product_id, from_location_id, to_location_id, quantity,
                  movement_type, user_id, reference, notes, movement_reason,
                  work_order_id, created_at)
             VALUES ($1, NULL, $2, 1, 'entry', $3, 'WO-DEMO-02', NULL,
                     'production_output', $4, NOW() - INTERVAL '1 hour')",
        )
        .bind(pue_her_bas_id)
        .bind(producto_terminado_id)
        .bind(admin_id)
        .bind(wo_02_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    info!("seed_work_orders_demo: phase 5 seed complete");
    Ok(())
}

// Helper shared between the Almacén-Principal-present and absent paths of
// `seed_work_orders_demo`. Performs 5.3 (insert PUE-HER-BAS) and 5.4
// (ensure REC-01 has items — no-op when the items already exist since the
// existing `seed_recipes` inserts 6).
async fn seed_phase5_product_and_recipe(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Result<()> {
    // 5.3 — Manufacturable raw_material SKU.
    // Category lookup: prefer the `Aceros y metales` category seeded in
    // `seed_core`. If absent (unlikely), fall back to NULL — the products
    // table allows NULL category_id.
    let category_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM categories WHERE name = 'Aceros y metales' LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;

    sqlx::query(
        "INSERT INTO products
             (name, sku, category_id, unit_of_measure, min_stock, max_stock,
              product_class, has_expiry, is_manufactured)
         VALUES ('Puerta herrería básica', 'PUE-HER-BAS', $1, 'piece', 0, 50,
                 'raw_material', FALSE, TRUE)
         ON CONFLICT (sku) DO NOTHING",
    )
    .bind(category_id)
    .execute(&mut **tx)
    .await?;

    // 5.4 — Recipe items guard. The existing `seed_recipes` already
    // inserts 6 items for REC-01 ('Puerta herrería básica'). This pre-check
    // is a belt-and-suspenders for the seed-in-isolation case where
    // recipes may exist (from a prior partial run) but items are missing.
    // We deliberately do NOT insert items here — the canonical ingredient
    // set lives in `seed_recipes`. Here we only ASSERT the invariant and
    // log a warning if it fails, so integration tests catch the gap.
    let rec_01_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM recipes WHERE name = 'Puerta herrería básica' AND deleted_at IS NULL LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(rec_01_id) = rec_01_id {
        let item_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM recipe_items WHERE recipe_id = $1",
        )
        .bind(rec_01_id)
        .fetch_one(&mut **tx)
        .await?;

        if item_count < 3 {
            // Seed a minimal 3-item fallback using available raw_material /
            // consumable SKUs. This path only fires if `seed_recipes` did
            // not run (e.g. partial-seed DB); when it ran, item_count=6.
            tracing::warn!(
                "seed_work_orders_demo: REC-01 has only {item_count} items; backfilling 3 minimal items"
            );
            // Pick any 3 raw_material SKUs; tool_spare excluded by WHERE.
            let fallback_items = sqlx::query_as::<_, (Uuid,)>(
                "SELECT id FROM products
                 WHERE product_class IN ('raw_material', 'consumable')
                   AND deleted_at IS NULL
                   AND sku <> 'PUE-HER-BAS'
                 ORDER BY created_at ASC
                 LIMIT 3",
            )
            .fetch_all(&mut **tx)
            .await?;

            for (idx, (product_id,)) in fallback_items.into_iter().enumerate() {
                let qty = (idx as f64) + 1.0;
                sqlx::query(
                    "INSERT INTO recipe_items (recipe_id, product_id, quantity, notes)
                     VALUES ($1, $2, $3, 'Fallback seed — verifique receta')
                     ON CONFLICT (recipe_id, product_id) DO NOTHING",
                )
                .bind(rec_01_id)
                .bind(product_id)
                .bind(qty)
                .execute(&mut **tx)
                .await?;
            }
        }
    }

    Ok(())
}
