-- Multi-Tenant Foundation — Phase B Batch 6
-- Adds `tenant_id` to `purchase_orders`, `purchase_order_lines`,
-- `purchase_returns`, and `purchase_return_items` (the procurement +
-- supplier-return tables, all derived from suppliers + products which
-- carry tenant_id post-B2..B3). This batch also retrofits
-- `movements.purchase_order_id` and `product_lots.purchase_order_line_id`
-- to composite FKs now that their parent tables carry tenant_id.
--
-- B6 inherits patterns from B1..B5:
--   * Junction-table composite FKs to BOTH parents (B3) — purchase_order_lines
--     and purchase_return_items follow the supplier_products / recipe_items
--     template.
--   * Pre-install `(tenant_id, id) UNIQUE` on parents (B4 rule) —
--     purchase_orders (movements + purchase_returns + purchase_order_lines
--     composite-FK back), purchase_order_lines (product_lots composite-FK
--     back), purchase_returns (purchase_return_items composite-FK back).
--   * `(tenant_id, code) UNIQUE` replaces global `(code) UNIQUE` (B5
--     work_orders.code template) — applied to purchase_orders.order_number
--     AND purchase_returns.return_number so two tenants can both generate
--     "PO-..." / "PR-..." numbers without colliding.
--   * NULLABLE composite FK with MATCH SIMPLE (B4 rule) for
--     movements.purchase_order_id and product_lots.purchase_order_line_id —
--     both are nullable parents-of-convenience.
--   * add-before-drop on every composite-FK swap (B1..B4 rule).
--
-- Operation order (parents first → composite-FK targets first):
--   1. purchase_orders: add tenant_id (backfill from parent supplier — the
--      PO has supplier_id NOT NULL and suppliers carries tenant_id post-B3),
--      tenant FK RESTRICT, idx, `(tenant_id, id) UNIQUE` (target for
--      purchase_order_lines + purchase_returns + movements.purchase_order_id
--      retrofit), `(tenant_id, order_number)` UNIQUE replacing the global
--      `(order_number)` UNIQUE, composite FK to suppliers.
--   2. purchase_order_lines: add tenant_id (backfill from parent PO),
--      tenant FK, idx, `(tenant_id, id) UNIQUE` (target for
--      product_lots.purchase_order_line_id retrofit), composite FK to
--      purchase_orders (CASCADE preserved) + composite FK to products.
--   3. purchase_returns: add tenant_id (backfill from parent PO), tenant FK,
--      idx, `(tenant_id, id) UNIQUE` (target for purchase_return_items),
--      `(tenant_id, return_number)` UNIQUE replacing the global
--      `(return_number)` UNIQUE, composite FK to purchase_orders.
--   4. purchase_return_items: add tenant_id (backfill from parent return),
--      tenant FK, idx, composite FK to purchase_returns (CASCADE preserved)
--      + composite FK to products.
--   5. movements.purchase_order_id retrofit: ADD composite FK
--      `(tenant_id, purchase_order_id) → purchase_orders(tenant_id, id)`
--      MATCH SIMPLE (the column is NULLABLE on movements) BEFORE dropping
--      the old single-column FK. Mirrors the B5 work_order_id retrofit.
--      Original FK has no ON DELETE clause (NO ACTION default) — preserved.
--   6. product_lots.purchase_order_line_id retrofit: ADD composite FK
--      `(tenant_id, purchase_order_line_id) → purchase_order_lines(tenant_id, id)`
--      MATCH SIMPLE BEFORE dropping the old single-column FK. Same shape
--      as the movements retrofit.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite
-- FK pattern). B6 closes the purchase_order_id / purchase_order_line_id
-- retrofit gaps that B4 deliberately deferred (B4 migration §11).

-- ─── purchase_orders ─────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE purchase_orders ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent supplier. Every purchase_orders row references
--    one supplier (NOT NULL FK), and suppliers carries tenant_id post-B3.
UPDATE purchase_orders po
   SET tenant_id = s.tenant_id
  FROM suppliers s
 WHERE po.supplier_id = s.id;

-- 3) Lock it down.
ALTER TABLE purchase_orders ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_purchase_orders_tenant ON purchase_orders(tenant_id);

-- 6) Composite uniqueness target — required because purchase_order_lines,
--    purchase_returns, and the movements.purchase_order_id retrofit all
--    composite-FK to purchase_orders(tenant_id, id) below.
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Replace the global `UNIQUE(order_number)` with a tenant-scoped one.
--    Original: `order_number VARCHAR(100) NOT NULL UNIQUE`
--    (`20260409000001_purchase_orders.sql:14`). The auto-generated constraint
--    name follows the `<table>_<column>_key` Postgres convention. Two
--    tenants generating "PO-20260508-XXXX" / "OC-2026-100" simultaneously
--    must not collide; the generator includes only 4 hex chars of randomness
--    so cross-tenant collisions are realistic on a busy day, and the demo
--    seed uses the literal pattern `OC-2026-NNN` which would absolutely
--    collide across tenants.
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_order_number_key
    UNIQUE (tenant_id, order_number);

ALTER TABLE purchase_orders
    DROP CONSTRAINT purchase_orders_order_number_key;

-- 8) Composite FK to suppliers (NOT NULL). Original FK was the default-named
--    `purchase_orders_supplier_id_fkey` (no ON DELETE → NO ACTION).
--    Add-before-drop.
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_tenant_fk
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES suppliers(tenant_id, id);

ALTER TABLE purchase_orders
    DROP CONSTRAINT purchase_orders_supplier_id_fkey;

-- 9) `created_by` (user_id) STAYS a single-column FK to global users.
--    Same rationale as movements.user_id (B4 §10): users are
--    tenant-agnostic, the row's own tenant_id + Phase C RLS carry the
--    isolation.

-- ─── purchase_order_lines ────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE purchase_order_lines ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent PO (purchase_order_lines is junction-style:
--    every row references one purchase_order NOT NULL).
UPDATE purchase_order_lines pol
   SET tenant_id = po.tenant_id
  FROM purchase_orders po
 WHERE pol.purchase_order_id = po.id;

-- 3) Lock it down.
ALTER TABLE purchase_order_lines ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_purchase_order_lines_tenant ON purchase_order_lines(tenant_id);

-- 6) Composite uniqueness target — required because product_lots
--    composite-FKs to purchase_order_lines(tenant_id, id) in step §11 below.
ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Composite FK to purchase_orders — replaces the original single-column
--    FK (`purchase_orders.sql:27`: `REFERENCES purchase_orders(id)
--    ON DELETE CASCADE`). Add-before-drop.
ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_po_tenant_fk
    FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES purchase_orders(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE purchase_order_lines
    DROP CONSTRAINT purchase_order_lines_purchase_order_id_fkey;

-- 8) Composite FK to products — replaces the original single-column FK
--    (`purchase_orders.sql:28`: `REFERENCES products(id)`). Default ON
--    DELETE behavior (NO ACTION) preserved.
ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE purchase_order_lines
    DROP CONSTRAINT purchase_order_lines_product_id_fkey;

-- 9) The original `UNIQUE(purchase_order_id, product_id)` is preserved —
--    both refs are now composite-FK'd in the same tenant, so the constraint
--    is tenant-correct without modification.

-- ─── purchase_returns ────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE purchase_returns ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent PO.
UPDATE purchase_returns pr
   SET tenant_id = po.tenant_id
  FROM purchase_orders po
 WHERE pr.purchase_order_id = po.id;

-- 3) Lock it down.
ALTER TABLE purchase_returns ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_purchase_returns_tenant ON purchase_returns(tenant_id);

-- 6) Composite uniqueness target — required because purchase_return_items
--    composite-FKs to purchase_returns(tenant_id, id) below.
ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Replace the global `UNIQUE(return_number)` with a tenant-scoped one.
--    Original: `return_number VARCHAR(100) NOT NULL UNIQUE`
--    (`20260412000002_purchase_returns.sql:12`). Same rationale as
--    purchase_orders.order_number above — the demo seed uses literal
--    `RET-2026-NNN` codes that would collide across tenants.
ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_tenant_return_number_key
    UNIQUE (tenant_id, return_number);

ALTER TABLE purchase_returns
    DROP CONSTRAINT purchase_returns_return_number_key;

-- 8) Composite FK to purchase_orders (NOT NULL). Original FK was
--    default-named `purchase_returns_purchase_order_id_fkey` (no ON
--    DELETE → NO ACTION). Add-before-drop.
ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_po_tenant_fk
    FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES purchase_orders(tenant_id, id);

ALTER TABLE purchase_returns
    DROP CONSTRAINT purchase_returns_purchase_order_id_fkey;

-- 9) `requested_by_id` (user_id) STAYS a single-column FK to global users
--    — same rationale as purchase_orders.created_by above.

-- ─── purchase_return_items ───────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE purchase_return_items ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent return.
UPDATE purchase_return_items pri
   SET tenant_id = pr.tenant_id
  FROM purchase_returns pr
 WHERE pri.purchase_return_id = pr.id;

-- 3) Lock it down.
ALTER TABLE purchase_return_items ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE purchase_return_items
    ADD CONSTRAINT purchase_return_items_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_purchase_return_items_tenant ON purchase_return_items(tenant_id);

-- 6) Composite FK to purchase_returns — replaces the original
--    `purchase_return_items_purchase_return_id_fkey` with ON DELETE CASCADE
--    (junction-table convention, preserved).
ALTER TABLE purchase_return_items
    ADD CONSTRAINT purchase_return_items_pr_tenant_fk
    FOREIGN KEY (tenant_id, purchase_return_id)
    REFERENCES purchase_returns(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE purchase_return_items
    DROP CONSTRAINT purchase_return_items_purchase_return_id_fkey;

-- 7) Composite FK to products — replaces the original
--    `purchase_return_items_product_id_fkey` (no explicit ON DELETE → NO
--    ACTION).
ALTER TABLE purchase_return_items
    ADD CONSTRAINT purchase_return_items_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE purchase_return_items
    DROP CONSTRAINT purchase_return_items_product_id_fkey;

-- 8) The original `UNIQUE(purchase_return_id, product_id)` is preserved —
--    both refs share tenant_id via the composite FKs above.

-- ─── movements.purchase_order_id retrofit ────────────────────────────────
--
-- B4 deliberately left movements.purchase_order_id as a single-column FK
-- (B4 migration §11). Now that purchase_orders carries tenant_id with
-- `(tenant_id, id) UNIQUE`, retrofit movements.purchase_order_id to a
-- composite FK with MATCH SIMPLE (the column is NULLABLE — most movements
-- don't reference a PO).
--
-- Original FK: `movements_purchase_order_id_fkey` with NO explicit ON
-- DELETE clause → NO ACTION default (`20260409000001_purchase_orders.sql:50`).
-- No SET NULL semantics to lose — composite FK preserves the same
-- referential semantics. Add-before-drop.
ALTER TABLE movements
    ADD CONSTRAINT movements_purchase_order_tenant_fk
    FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES purchase_orders(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE movements
    DROP CONSTRAINT movements_purchase_order_id_fkey;

-- ─── product_lots.purchase_order_line_id retrofit ────────────────────────
--
-- Same rationale as the movements.purchase_order_id retrofit above.
-- product_lots carries tenant_id (B4) and purchase_order_lines now carries
-- tenant_id with `(tenant_id, id) UNIQUE` (step §6 of this migration), so
-- the previously single-column FK can be promoted to a composite FK with
-- MATCH SIMPLE (the column is NULLABLE — only PO-linked lots set it).
--
-- Original FK: `product_lots_purchase_order_line_id_fkey` with NO explicit
-- ON DELETE clause → NO ACTION default
-- (`20260409000001_purchase_orders.sql:46-47`). Add-before-drop.
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_po_line_tenant_fk
    FOREIGN KEY (tenant_id, purchase_order_line_id)
    REFERENCES purchase_order_lines(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE product_lots
    DROP CONSTRAINT product_lots_purchase_order_line_id_fkey;
