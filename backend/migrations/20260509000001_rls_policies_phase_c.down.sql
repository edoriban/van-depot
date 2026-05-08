-- Phase C task C1 rollback: drop every RLS policy + DISABLE / NO FORCE on
-- every table touched by the up migration.
--
-- DROP POLICY ... IF EXISTS for idempotency. ALTER TABLE ... DISABLE / NO FORCE
-- is also idempotent (no error if RLS isn't currently on).

BEGIN;

DROP POLICY IF EXISTS warehouses_tenant_isolation ON warehouses;
ALTER TABLE warehouses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouses DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locations_tenant_isolation ON locations;
ALTER TABLE locations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE locations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_tenant_isolation ON products;
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_tenant_isolation ON categories;
ALTER TABLE categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_tenant_isolation ON suppliers;
ALTER TABLE suppliers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_products_tenant_isolation ON supplier_products;
ALTER TABLE supplier_products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_products DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_tenant_isolation ON inventory;
ALTER TABLE inventory NO FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_lots_tenant_isolation ON product_lots;
ALTER TABLE product_lots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_lots DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_lots_tenant_isolation ON inventory_lots;
ALTER TABLE inventory_lots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS movements_tenant_isolation ON movements;
ALTER TABLE movements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE movements DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipes_tenant_isolation ON recipes;
ALTER TABLE recipes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipe_items_tenant_isolation ON recipe_items;
ALTER TABLE recipe_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE recipe_items DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_orders_tenant_isolation ON work_orders;
ALTER TABLE work_orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE work_orders DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_order_materials_tenant_isolation ON work_order_materials;
ALTER TABLE work_order_materials NO FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_materials DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_tenant_isolation ON purchase_orders;
ALTER TABLE purchase_orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_order_lines_tenant_isolation ON purchase_order_lines;
ALTER TABLE purchase_order_lines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_returns_tenant_isolation ON purchase_returns;
ALTER TABLE purchase_returns NO FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_return_items_tenant_isolation ON purchase_return_items;
ALTER TABLE purchase_return_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cycle_counts_tenant_isolation ON cycle_counts;
ALTER TABLE cycle_counts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cycle_counts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cycle_count_items_tenant_isolation ON cycle_count_items;
ALTER TABLE cycle_count_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_items DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_warehouses_tenant_isolation ON user_warehouses;
ALTER TABLE user_warehouses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE user_warehouses DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_configuration_tenant_isolation ON stock_configuration;
ALTER TABLE stock_configuration NO FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_configuration DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_instances_tenant_isolation ON tool_instances;
ALTER TABLE tool_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tool_instances DISABLE ROW LEVEL SECURITY;

COMMIT;
