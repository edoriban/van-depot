-- Phase C task C1 (multi-tenant-foundation): enable RLS + policies on every
-- tenant-scoped table.
--
-- Source of truth: `sdd/multi-tenant-foundation/design` §4 (RLS design),
-- spec "Tenant-Scoped Data Isolation" + "Per-Request Tenant Context".
--
-- Two session vars drive the policies:
--   * `app.current_tenant` (UUID as text) — the active tenant for the request.
--   * `app.is_superadmin` ('true' | 'false') — global bypass flag.
--
-- The middleware (`tenant_tx_middleware`) plants both via `set_config(...)`
-- inside the per-request transaction. RLS policies use
-- `current_setting('app.<name>', true)` (the second arg `true` makes a
-- missing setting return NULL instead of erroring).
--
-- Each tenant-scoped table gets:
--   1. `ENABLE ROW LEVEL SECURITY`,
--   2. `FORCE ROW LEVEL SECURITY` so even the SQLx connection role (table
--      owner) is bound by the policies,
--   3. one policy named `<table>_tenant_isolation` covering both `USING`
--      (read filter) and `WITH CHECK` (write enforcement).
--
-- DELIBERATELY EXEMPT from RLS:
--   * `tenants` — control-plane table, slug uniqueness must be enforced
--     globally; admin endpoints manage it.
--   * `users` — global identity table.
--   * `user_tenants` — the membership table itself. The middleware queries
--     this BEFORE planting the session vars (to verify membership), so it
--     must be readable on a fresh connection without RLS context.
--
-- All other Phase B tenant-scoped tables get the policy.

BEGIN;

-- ── warehouses ────────────────────────────────────────────────────────────
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouses_tenant_isolation ON warehouses
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── locations ─────────────────────────────────────────────────────────────
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant_isolation ON locations
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── products ──────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_tenant_isolation ON products
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── categories ────────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY categories_tenant_isolation ON categories
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── suppliers ─────────────────────────────────────────────────────────────
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_tenant_isolation ON suppliers
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── supplier_products ─────────────────────────────────────────────────────
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_products_tenant_isolation ON supplier_products
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── inventory ─────────────────────────────────────────────────────────────
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_tenant_isolation ON inventory
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── product_lots ──────────────────────────────────────────────────────────
ALTER TABLE product_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY product_lots_tenant_isolation ON product_lots
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── inventory_lots ────────────────────────────────────────────────────────
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_lots_tenant_isolation ON inventory_lots
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── movements ─────────────────────────────────────────────────────────────
ALTER TABLE movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements FORCE ROW LEVEL SECURITY;
CREATE POLICY movements_tenant_isolation ON movements
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── recipes ───────────────────────────────────────────────────────────────
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY recipes_tenant_isolation ON recipes
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── recipe_items ──────────────────────────────────────────────────────────
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_items_tenant_isolation ON recipe_items
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── work_orders ───────────────────────────────────────────────────────────
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY work_orders_tenant_isolation ON work_orders
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── work_order_materials ──────────────────────────────────────────────────
ALTER TABLE work_order_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_materials FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_materials_tenant_isolation ON work_order_materials
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── purchase_orders ───────────────────────────────────────────────────────
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_tenant_isolation ON purchase_orders
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── purchase_order_lines ──────────────────────────────────────────────────
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_lines_tenant_isolation ON purchase_order_lines
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── purchase_returns ──────────────────────────────────────────────────────
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_returns_tenant_isolation ON purchase_returns
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── purchase_return_items ─────────────────────────────────────────────────
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_return_items_tenant_isolation ON purchase_return_items
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── cycle_counts ──────────────────────────────────────────────────────────
ALTER TABLE cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY cycle_counts_tenant_isolation ON cycle_counts
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── cycle_count_items ─────────────────────────────────────────────────────
ALTER TABLE cycle_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_items FORCE ROW LEVEL SECURITY;
CREATE POLICY cycle_count_items_tenant_isolation ON cycle_count_items
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── notifications ─────────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── user_warehouses ───────────────────────────────────────────────────────
ALTER TABLE user_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY user_warehouses_tenant_isolation ON user_warehouses
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── stock_configuration ───────────────────────────────────────────────────
ALTER TABLE stock_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_configuration_tenant_isolation ON stock_configuration
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- ── tool_instances ────────────────────────────────────────────────────────
ALTER TABLE tool_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY tool_instances_tenant_isolation ON tool_instances
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
    );

COMMIT;
