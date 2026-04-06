use anyhow::Result;
use sqlx::PgPool;
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

/// Seeds realistic demo data for a Mexican herrería workshop.
///
/// Idempotent: skips entirely if any warehouses already exist.
pub async fn seed_demo_data(pool: &PgPool) -> Result<()> {
    let warehouse_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM warehouses")
        .fetch_one(pool)
        .await?;

    if warehouse_count > 0 {
        info!("Demo data already exists, skipping seed");
        return Ok(());
    }

    info!("Seeding demo data...");

    // Get superadmin user_id for movements
    let superadmin_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1",
    )
    .fetch_one(pool)
    .await?;

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
    .execute(pool)
    .await?;

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
    .execute(pool)
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
    .execute(pool)
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
    .execute(pool)
    .await?;

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
    .execute(pool)
    .await?;

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
    .execute(pool)
    .await?;

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

    sqlx::query(
        "INSERT INTO products (id, name, sku, category_id, unit_of_measure, min_stock, max_stock) VALUES
         ($1,  'Tubo redondo 2\"',        'TUB-RED-2', $16, 'meter', 20, 100),
         ($2,  'Tubo cuadrado 1\"',       'TUB-CUA-1', $16, 'meter', 15, 80),
         ($3,  'Perfil PTR 2x2',         'PTR-2X2',   $16, 'meter', 10, 50),
         ($4,  'Ángulo 1\"x1/8\"',       'ANG-1-18',  $16, 'meter', 10, 40),
         ($5,  'Lámina cal 14',          'LAM-C14',   $16, 'piece', 5,  20),
         ($6,  'Solera 1\"x1/4\"',       'SOL-1-14',  $16, 'meter', 10, 50),
         ($7,  'Electrodo 6013',         'ELE-6013',  $17, 'kg',    5,  25),
         ($8,  'Electrodo 7018',         'ELE-7018',  $17, 'kg',    3,  15),
         ($9,  'Gas argón tanque',       'GAS-ARG',   $17, 'piece', 1,  3),
         ($10, 'Disco de corte 7\"',     'DIS-COR-7', $18, 'piece', 10, 50),
         ($11, 'Disco de desbaste 7\"',  'DIS-DES-7', $18, 'piece', 5,  30),
         ($12, 'Pintura anticorrosiva roja', 'PIN-ANT-R', $19, 'liter', 4, 20),
         ($13, 'Thinner',                'THI-STD',   $19, 'liter', 5,  25),
         ($14, 'Tornillo 1/4\"x1\"',     'TOR-14-1',  $20, 'piece', 100, 500),
         ($15, 'Bisagra industrial 4\"', 'BIS-IND-4', $20, 'piece', 20, 100)",
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
    .execute(pool)
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
    .execute(pool)
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
    .execute(pool).await?;

    // 2. Tubo cuadrado entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 40, 'entry', $3, 'OC-2026-001', 'Compra semanal de tubo cuadrado', $4, NOW() - INTERVAL '7 days' + INTERVAL '1 hour')",
    )
    .bind(prod_tubo_cua).bind(rack_a_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(pool).await?;

    // 3. PTR entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 30, 'entry', $3, 'OC-2026-002', 'Resurtido de PTR', $4, NOW() - INTERVAL '6 days')",
    )
    .bind(prod_ptr).bind(rack_a_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(pool).await?;

    // 4. Ángulo entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 50, 'entry', $3, 'OC-2026-003', 'Compra de ángulo', $4, NOW() - INTERVAL '6 days' + INTERVAL '3 hours')",
    )
    .bind(prod_angulo).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(pool).await?;

    // 5. Solera entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 35, 'entry', $3, 'OC-2026-003', 'Compra de solera', $4, NOW() - INTERVAL '5 days')",
    )
    .bind(prod_solera).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(pool).await?;

    // 6. Lámina entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 15, 'entry', $3, 'OC-2026-004', 'Láminas calibre 14', $4, NOW() - INTERVAL '5 days' + INTERVAL '2 hours')",
    )
    .bind(prod_lamina).bind(rack_b_id).bind(superadmin_id).bind(sup_aceros_id)
    .execute(pool).await?;

    // 7. Electrodo 6013 entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 12, 'entry', $3, 'OC-2026-005', 'Electrodos 6013 para la semana', $4, NOW() - INTERVAL '4 days')",
    )
    .bind(prod_ele_6013).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(pool).await?;

    // 8. Electrodo 7018 entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 6, 'entry', $3, 'OC-2026-005', 'Electrodos 7018', $4, NOW() - INTERVAL '4 days' + INTERVAL '30 minutes')",
    )
    .bind(prod_ele_7018).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(pool).await?;

    // 9. Gas argón entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 3, 'entry', $3, 'OC-2026-006', 'Tanques de argón', $4, NOW() - INTERVAL '4 days' + INTERVAL '2 hours')",
    )
    .bind(prod_gas_arg).bind(zona_soldadura_id).bind(superadmin_id).bind(sup_soldaduras_id)
    .execute(pool).await?;

    // 10. Disco de corte entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 30, 'entry', $3, 'OC-2026-007', 'Discos de corte', $4, NOW() - INTERVAL '3 days')",
    )
    .bind(prod_disco_corte).bind(herramientas_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(pool).await?;

    // 11. Disco de desbaste entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 20, 'entry', $3, 'OC-2026-007', 'Discos de desbaste', $4, NOW() - INTERVAL '3 days' + INTERVAL '1 hour')",
    )
    .bind(prod_disco_desb).bind(herramientas_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(pool).await?;

    // 12. Pintura entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 15, 'entry', $3, 'OC-2026-008', 'Pintura anticorrosiva', $4, NOW() - INTERVAL '3 days' + INTERVAL '4 hours')",
    )
    .bind(prod_pintura).bind(bodega_general_id).bind(superadmin_id).bind(sup_pinturas_id)
    .execute(pool).await?;

    // 13. Thinner entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 12, 'entry', $3, 'OC-2026-008', 'Thinner estándar', $4, NOW() - INTERVAL '2 days')",
    )
    .bind(prod_thinner).bind(bodega_general_id).bind(superadmin_id).bind(sup_pinturas_id)
    .execute(pool).await?;

    // 14. Tornillo entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 300, 'entry', $3, 'OC-2026-009', 'Tornillos 1/4', $4, NOW() - INTERVAL '2 days' + INTERVAL '3 hours')",
    )
    .bind(prod_tornillo).bind(bodega_general_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(pool).await?;

    // 15. Bisagra entry
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, supplier_id, created_at)
         VALUES ($1, NULL, $2, 60, 'entry', $3, 'OC-2026-009', 'Bisagras industriales', $4, NOW() - INTERVAL '2 days' + INTERVAL '4 hours')",
    )
    .bind(prod_bisagra).bind(bodega_general_id).bind(superadmin_id).bind(sup_ferreteria_id)
    .execute(pool).await?;

    // -- 3 exit movements (material consumed for projects) --
    // 16. Tubo redondo exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 15, 'exit', $3, 'PROY-2026-010', 'Proyecto puerta herrería García', NOW() - INTERVAL '1 day')",
    )
    .bind(prod_tubo_red).bind(rack_a_id).bind(superadmin_id)
    .execute(pool).await?;

    // 17. Tubo cuadrado exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 10, 'exit', $3, 'PROY-2026-010', 'Proyecto puerta herrería García', NOW() - INTERVAL '1 day' + INTERVAL '2 hours')",
    )
    .bind(prod_tubo_cua).bind(rack_a_id).bind(superadmin_id)
    .execute(pool).await?;

    // 18. Electrodo 6013 exit
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, NULL, 4, 'exit', $3, 'PROY-2026-010', 'Electrodos consumidos en proyecto', NOW() - INTERVAL '1 day' + INTERVAL '4 hours')",
    )
    .bind(prod_ele_6013).bind(zona_soldadura_id).bind(superadmin_id)
    .execute(pool).await?;

    // -- 1 transfer movement --
    // 19. Transfer pintura from Bodega Sur to Almacén Principal
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, $2, $3, 5, 'transfer', $4, 'TRANS-001', 'Transferencia de pintura a almacén principal', NOW() - INTERVAL '12 hours')",
    )
    .bind(prod_pintura).bind(bodega_general_id).bind(herramientas_id).bind(superadmin_id)
    .execute(pool).await?;

    // -- 1 adjustment movement --
    // 20. Lámina adjustment (damaged stock)
    sqlx::query(
        "INSERT INTO movements (product_id, from_location_id, to_location_id, quantity, movement_type, user_id, reference, notes, created_at)
         VALUES ($1, NULL, $2, -3, 'adjustment', $3, 'AJUSTE-001', 'Ajuste por inventario físico — láminas dañadas', NOW() - INTERVAL '6 hours')",
    )
    .bind(prod_lamina).bind(rack_b_id).bind(superadmin_id)
    .execute(pool).await?;

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
    .execute(pool)
    .await?;

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
    .execute(pool)
    .await?;

    info!("Demo data seeded successfully: 2 warehouses, 12 locations, 5 categories, 4 suppliers, 15 products, 15 inventory records, 20 movements, 3 users");
    Ok(())
}
