-- Down for 20260508000005_tenant_id_recipes_work_orders.sql
-- Reverses every operation in REVERSE table order: movements retrofit
-- first, then work_order_materials → work_orders → recipe_items →
-- recipes LAST (because recipe_items composite-FKs to recipes(tenant_id,
-- id) UNIQUE, work_order_materials composite-FKs to work_orders, and
-- movements composite-FKs to work_orders).
--
-- Inside each table, restore single-column FKs BEFORE dropping
-- composites so the columns are continuously enforced.

-- ─── movements.work_order_id retrofit reversal ───────────────────────────

-- Restore single-column FK with original ON DELETE SET NULL semantics
-- (per add_work_order_id_to_movements.sql:6).
ALTER TABLE movements
    ADD CONSTRAINT movements_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL;

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_work_order_tenant_fk;

-- ─── work_order_materials: restore single-column FKs, drop composites ────

ALTER TABLE work_order_materials
    ADD CONSTRAINT work_order_materials_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE work_order_materials DROP CONSTRAINT IF EXISTS work_order_materials_product_tenant_fk;

ALTER TABLE work_order_materials
    ADD CONSTRAINT work_order_materials_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

ALTER TABLE work_order_materials DROP CONSTRAINT IF EXISTS work_order_materials_work_order_tenant_fk;

DROP INDEX IF EXISTS idx_work_order_materials_tenant;
ALTER TABLE work_order_materials DROP CONSTRAINT IF EXISTS work_order_materials_tenant_fk;
ALTER TABLE work_order_materials DROP COLUMN IF EXISTS tenant_id;

-- ─── work_orders: restore single-column FKs, drop composites + UNIQUE ────

ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_work_center_location_id_fkey
    FOREIGN KEY (work_center_location_id) REFERENCES locations(id);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_work_center_tenant_fk;

ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_warehouse_tenant_fk;

ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_fg_product_id_fkey
    FOREIGN KEY (fg_product_id) REFERENCES products(id);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_fg_product_tenant_fk;

ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_recipe_id_fkey
    FOREIGN KEY (recipe_id) REFERENCES recipes(id);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_recipe_tenant_fk;

-- Restore the global `(code)` UNIQUE.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_code_key UNIQUE (code);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_tenant_code_key;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_tenant_id_id_key;
DROP INDEX IF EXISTS idx_work_orders_tenant;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_tenant_fk;
ALTER TABLE work_orders DROP COLUMN IF EXISTS tenant_id;

-- ─── recipe_items: restore single-column FKs, drop composites ────────────

ALTER TABLE recipe_items
    ADD CONSTRAINT recipe_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE recipe_items DROP CONSTRAINT IF EXISTS recipe_items_product_tenant_fk;

ALTER TABLE recipe_items
    ADD CONSTRAINT recipe_items_recipe_id_fkey
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE;

ALTER TABLE recipe_items DROP CONSTRAINT IF EXISTS recipe_items_recipe_tenant_fk;

DROP INDEX IF EXISTS idx_recipe_items_tenant;
ALTER TABLE recipe_items DROP CONSTRAINT IF EXISTS recipe_items_tenant_fk;
ALTER TABLE recipe_items DROP COLUMN IF EXISTS tenant_id;

-- ─── recipes: drop composite-FK target + tenant_id ───────────────────────

ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_tenant_id_id_key;
DROP INDEX IF EXISTS idx_recipes_tenant;
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_tenant_fk;
ALTER TABLE recipes DROP COLUMN IF EXISTS tenant_id;
