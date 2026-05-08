-- Down for 20260508000004_tenant_id_movements_inventory_lots.sql
-- Reverses every operation in REVERSE table order: movements first,
-- inventory next, inventory_lots after, product_lots LAST (because
-- inventory_lots' composite FK targets product_lots(tenant_id, id) UNIQUE
-- and that constraint must come down only after the FK that references it).
--
-- Inside each table, restore single-column FKs BEFORE dropping composites
-- so the columns are continuously enforced.

-- ─── movements: restore single-column FKs, drop composites ───────────────

-- Restore single-column FK to suppliers.
ALTER TABLE movements
    ADD CONSTRAINT movements_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_supplier_tenant_fk;

-- Restore single-column FK to to_location.
ALTER TABLE movements
    ADD CONSTRAINT movements_to_location_id_fkey
    FOREIGN KEY (to_location_id) REFERENCES locations(id);

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_to_location_tenant_fk;

-- Restore single-column FK to from_location.
ALTER TABLE movements
    ADD CONSTRAINT movements_from_location_id_fkey
    FOREIGN KEY (from_location_id) REFERENCES locations(id);

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_from_location_tenant_fk;

-- Restore single-column FK to products.
ALTER TABLE movements
    ADD CONSTRAINT movements_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_product_tenant_fk;

DROP INDEX IF EXISTS idx_movements_tenant;
ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_tenant_fk;
ALTER TABLE movements DROP COLUMN IF EXISTS tenant_id;

-- ─── inventory: restore single-column FKs, drop composites ───────────────

ALTER TABLE inventory
    ADD CONSTRAINT inventory_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_location_tenant_fk;

ALTER TABLE inventory
    ADD CONSTRAINT inventory_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_tenant_fk;

DROP INDEX IF EXISTS idx_inventory_tenant;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_tenant_fk;
ALTER TABLE inventory DROP COLUMN IF EXISTS tenant_id;

-- ─── inventory_lots: restore single-column FKs, drop composites ──────────

ALTER TABLE inventory_lots
    ADD CONSTRAINT inventory_lots_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations(id);

ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS inventory_lots_location_tenant_fk;

ALTER TABLE inventory_lots
    ADD CONSTRAINT inventory_lots_product_lot_id_fkey
    FOREIGN KEY (product_lot_id) REFERENCES product_lots(id) ON DELETE CASCADE;

ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS inventory_lots_product_lot_tenant_fk;

DROP INDEX IF EXISTS idx_inventory_lots_tenant;
ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS inventory_lots_tenant_fk;
ALTER TABLE inventory_lots DROP COLUMN IF EXISTS tenant_id;

-- ─── product_lots: restore single-column FKs, drop composites + UNIQUE ───

ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_supplier_tenant_fk;

ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_product_tenant_fk;

ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_tenant_id_id_key;
DROP INDEX IF EXISTS idx_product_lots_tenant;
ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_tenant_fk;
ALTER TABLE product_lots DROP COLUMN IF EXISTS tenant_id;

-- ─── locations: drop additive (tenant_id, id) UNIQUE ─────────────────────
--
-- Added by B4 to be the FK target for inventory_lots / inventory /
-- movements. Now that all four B4 tables are unwound, this constraint
-- has no remaining references and can be dropped cleanly.
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_tenant_id_id_key;
