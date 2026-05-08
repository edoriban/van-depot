-- Multi-Tenant Foundation — Phase B Batch 5
-- Adds `tenant_id` to `recipes`, `recipe_items`, `work_orders`, and
-- `work_order_materials` (the BOM + production-order tables, all derived
-- from products + warehouses + locations, all of which carry tenant_id
-- post-B1..B2). This batch also retrofits `movements.work_order_id` to a
-- composite FK now that `work_orders` itself carries tenant_id.
--
-- B5 inherits patterns from B1..B4:
--   * NULLABLE composite FK with MATCH SIMPLE (B4) — none required this
--     batch (recipe_id on work_orders is NOT NULL, work_order_id on
--     movements is NULLABLE → MATCH SIMPLE retrofit).
--   * Junction-table composite FKs to BOTH parents (B3) — recipe_items
--     and work_order_materials follow the supplier_products template.
--   * Pre-install `(tenant_id, id) UNIQUE` on parents in this migration
--     (B4 rule) — recipes and work_orders both gain it because their
--     children composite-FK back, and movements composite-FKs to
--     work_orders.
--   * add-before-drop on every composite-FK swap (B1..B4 rule).
--
-- Operation order (parents first → composite-FK targets first):
--   1. recipes: add tenant_id (backfill from products via the recipe
--      header — but recipes has no product_id today; backfill from the
--      seeded `dev` tenant per B3 charter), tenant FK RESTRICT, idx,
--      `(tenant_id, id) UNIQUE` (target for recipe_items).
--   2. recipe_items: add tenant_id (backfill from parent recipe), tenant
--      FK, idx, composite FK to recipes (CASCADE) + composite FK to
--      products. Replaces both single-column FKs.
--   3. work_orders: add tenant_id (backfill from parent warehouse — the
--      WO has warehouse_id NOT NULL and warehouses carries tenant_id
--      post-B1), tenant FK RESTRICT, idx, `(tenant_id, id) UNIQUE`
--      (target for work_order_materials AND for movements.work_order_id
--      retrofit), `(tenant_id, code)` UNIQUE replacing the global
--      `(code)` UNIQUE (so two tenants can both own a "WO-..." code),
--      composite FK to recipes (NOT NULL), composite FK to products
--      (fg_product_id, NOT NULL), composite FK to warehouses (NOT NULL),
--      composite FK to locations (work_center_location_id, NOT NULL).
--   4. work_order_materials: add tenant_id (backfill from parent
--      work_order), tenant FK, idx, composite FK to work_orders
--      (CASCADE) + composite FK to products.
--   5. movements.work_order_id retrofit: ADD composite FK
--      `(tenant_id, work_order_id) → work_orders(tenant_id, id)` MATCH
--      SIMPLE (the column is NULLABLE on movements) BEFORE dropping the
--      old single-column FK. Mirrors the suppliers / from_location_id /
--      to_location_id pattern from B4.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3
-- (composite FK pattern). B5 closes the work_order_id retrofit gap that
-- B4 deliberately deferred (B4 migration §10–§12).

-- ─── recipes ─────────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE recipes ADD COLUMN tenant_id UUID;

-- 2) Backfill from the seeded `dev` tenant. (Drop-and-reseed approved per
--    Phase B charter — no customer data on dev DB. Recipes has no
--    product_id, no warehouse_id; the only available parent is the
--    creating user, and users are tenant-agnostic in our design. So we
--    backfill via the dev tenant directly, same as suppliers in B3.)
UPDATE recipes
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE recipes ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE recipes
    ADD CONSTRAINT recipes_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_recipes_tenant ON recipes(tenant_id);

-- 6) Composite uniqueness target — required because recipe_items and
--    work_orders both composite-FK to recipes(tenant_id, id) below.
ALTER TABLE recipes
    ADD CONSTRAINT recipes_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Original schema has no UNIQUE on `recipes.name` — leave as-is.
--    Within-tenant duplicate names are operationally allowed; if a
--    future migration wants to constrain it, do a tenant-scoped partial
--    UNIQUE (B2 categories template).

-- ─── recipe_items ────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE recipe_items ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent recipe (recipe_items is a junction-style
--    child: every row references one recipe NOT NULL).
UPDATE recipe_items ri
   SET tenant_id = r.tenant_id
  FROM recipes r
 WHERE ri.recipe_id = r.id;

-- 3) Lock it down.
ALTER TABLE recipe_items ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE recipe_items
    ADD CONSTRAINT recipe_items_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_recipe_items_tenant ON recipe_items(tenant_id);

-- 6) Composite FK to recipes — replaces the original single-column FK
--    (`recipes.sql:17`: `recipe_id UUID NOT NULL REFERENCES recipes(id)
--    ON DELETE CASCADE`). Add-before-drop.
ALTER TABLE recipe_items
    ADD CONSTRAINT recipe_items_recipe_tenant_fk
    FOREIGN KEY (tenant_id, recipe_id)
    REFERENCES recipes(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE recipe_items
    DROP CONSTRAINT recipe_items_recipe_id_fkey;

-- 7) Composite FK to products — replaces the original single-column FK
--    (`recipes.sql:18`: `product_id UUID NOT NULL REFERENCES
--    products(id)`). Default ON DELETE behavior (NO ACTION) preserved.
ALTER TABLE recipe_items
    ADD CONSTRAINT recipe_items_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE recipe_items
    DROP CONSTRAINT recipe_items_product_id_fkey;

-- 8) The original `UNIQUE(recipe_id, product_id)` is preserved — both
--    refs are now composite-FK'd in the same tenant, so the constraint
--    is tenant-correct without modification.

-- ─── work_orders ─────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE work_orders ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent warehouse. work_orders.warehouse_id is
--    NOT NULL and warehouses carries tenant_id post-B1.
UPDATE work_orders wo
   SET tenant_id = w.tenant_id
  FROM warehouses w
 WHERE wo.warehouse_id = w.id;

-- 3) Lock it down.
ALTER TABLE work_orders ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_work_orders_tenant ON work_orders(tenant_id);

-- 6) Composite uniqueness target — required because work_order_materials
--    composite-FKs to work_orders(tenant_id, id), AND because
--    movements.work_order_id is retrofitted to a composite FK below.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Replace the global `UNIQUE(code)` with a tenant-scoped one.
--    Original: `code VARCHAR(50) NOT NULL UNIQUE`
--    (`create_work_orders_and_materials.sql:8`). Two tenants generating
--    "WO-20260508-ABCDEF" simultaneously must not collide; the
--    generator includes only 6 hex chars of randomness so cross-tenant
--    collisions are realistic on a busy day.
--    The auto-generated constraint name is `work_orders_code_key` per
--    Postgres' UNIQUE convention; drop it then add the tenant-scoped
--    equivalent.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_tenant_code_key
    UNIQUE (tenant_id, code);

ALTER TABLE work_orders
    DROP CONSTRAINT work_orders_code_key;

-- 8) Composite FK to recipes (NOT NULL). Original FK was the
--    default-named `work_orders_recipe_id_fkey` (no ON DELETE → NO
--    ACTION). Add-before-drop.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_recipe_tenant_fk
    FOREIGN KEY (tenant_id, recipe_id)
    REFERENCES recipes(tenant_id, id);

ALTER TABLE work_orders
    DROP CONSTRAINT work_orders_recipe_id_fkey;

-- 9) Composite FK to products (fg_product_id, NOT NULL).
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_fg_product_tenant_fk
    FOREIGN KEY (tenant_id, fg_product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE work_orders
    DROP CONSTRAINT work_orders_fg_product_id_fkey;

-- 10) Composite FK to warehouses (NOT NULL).
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_warehouse_tenant_fk
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES warehouses(tenant_id, id);

ALTER TABLE work_orders
    DROP CONSTRAINT work_orders_warehouse_id_fkey;

-- 11) Composite FK to locations (work_center_location_id, NOT NULL).
--     locations(tenant_id, id) UNIQUE was installed in B4.
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_work_center_tenant_fk
    FOREIGN KEY (tenant_id, work_center_location_id)
    REFERENCES locations(tenant_id, id);

ALTER TABLE work_orders
    DROP CONSTRAINT work_orders_work_center_location_id_fkey;

-- 12) `created_by` (user_id) STAYS a single-column FK to global users.
--     Same rationale as movements.user_id (B4 §10): users are
--     tenant-agnostic, the row's own tenant_id + Phase C RLS carry the
--     isolation.

-- ─── work_order_materials ────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE work_order_materials ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent work_order.
UPDATE work_order_materials wom
   SET tenant_id = wo.tenant_id
  FROM work_orders wo
 WHERE wom.work_order_id = wo.id;

-- 3) Lock it down.
ALTER TABLE work_order_materials ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE work_order_materials
    ADD CONSTRAINT work_order_materials_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_work_order_materials_tenant ON work_order_materials(tenant_id);

-- 6) Composite FK to work_orders — replaces the original
--    `work_order_materials_work_order_id_fkey` with ON DELETE CASCADE
--    (junction-table convention, preserved).
ALTER TABLE work_order_materials
    ADD CONSTRAINT work_order_materials_work_order_tenant_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES work_orders(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE work_order_materials
    DROP CONSTRAINT work_order_materials_work_order_id_fkey;

-- 7) Composite FK to products — replaces the original
--    `work_order_materials_product_id_fkey` (no explicit ON DELETE → NO
--    ACTION).
ALTER TABLE work_order_materials
    ADD CONSTRAINT work_order_materials_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE work_order_materials
    DROP CONSTRAINT work_order_materials_product_id_fkey;

-- 8) The original `UNIQUE(work_order_id, product_id)` is preserved —
--    both refs share tenant_id via the composite FKs above.

-- ─── movements.work_order_id retrofit ────────────────────────────────────
--
-- B4 deliberately left movements.work_order_id as a single-column FK
-- (B4 migration §12). Now that work_orders carries tenant_id with
-- `(tenant_id, id) UNIQUE`, retrofit movements.work_order_id to a
-- composite FK with MATCH SIMPLE (the column is NULLABLE — most
-- movements don't reference a WO).
--
-- Original FK: `movements_work_order_id_fkey` with ON DELETE SET NULL
-- (`add_work_order_id_to_movements.sql:6`). Add-before-drop preserves
-- enforcement throughout.
--
-- ON DELETE SET NULL is NOT preserved on the composite FK because PG's
-- ON DELETE SET NULL on a composite FK requires nulling BOTH columns,
-- which would also null tenant_id and violate its NOT NULL. Instead,
-- we drop the SET NULL semantics — work_orders are soft-deleted
-- (deleted_at column), not hard-deleted, so the SET NULL path is
-- already a dead branch in practice. If a future migration ever does
-- a hard delete on work_orders, that should be done in a tenant-aware
-- maintenance operation that explicitly nulls movements.work_order_id
-- first (or the RESTRICT will surface the cleanup need).
ALTER TABLE movements
    ADD CONSTRAINT movements_work_order_tenant_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES work_orders(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE movements
    DROP CONSTRAINT movements_work_order_id_fkey;
