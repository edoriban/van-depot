-- Multi-Tenant Foundation — Phase B Batch 4
-- Adds `tenant_id` to `product_lots`, `inventory_lots`, `inventory`, and
-- `movements` (the four "operational" tables, all derived from products +
-- locations + suppliers, all of which carry tenant_id post-B1..B3).
--
-- This is the heaviest batch:
--   * 4 tables, several composite FKs (some nullable → MATCH SIMPLE).
--   * Movement edges fan out to up to FIVE other tenant-scoped tables
--     (product, from_location, to_location, supplier — nullable, plus
--     the Phase B7 work_orders retrofit which we leave for later).
--   * `created_by` (movements.user_id) and `created_by` analogues remain
--     single-column FKs to global `users` (superadmin can act in any tenant;
--     the row's own tenant_id + RLS in Phase C carry the isolation).
--
-- Operation order (parents first → composite-FK targets first):
--   1. product_lots: add tenant_id (backfill from products via product_id),
--      tenant FK RESTRICT, idx, composite FKs to products + suppliers
--      (the supplier FK is nullable → MATCH SIMPLE), and add the parent-side
--      `(tenant_id, id) UNIQUE` because inventory_lots will composite-FK to
--      product_lots in step 2 (B3 LEARNING: install the FK target in the
--      same migration that introduces it; otherwise a future batch has to
--      retrofit it).
--   2. inventory_lots: add tenant_id (backfill from product_lots),
--      tenant FK RESTRICT, idx, composite FKs to product_lots + locations.
--      No `(tenant_id, id) UNIQUE` — nothing composite-FKs into it yet.
--   3. inventory: add tenant_id (backfill from products), tenant FK
--      RESTRICT, idx, composite FKs to products + locations. Existing
--      `UNIQUE(product_id, location_id)` is preserved AS-IS (the composite
--      FKs already imply tenant_id agreement; two rows sharing
--      (product_id, location_id) MUST share tenant_id).
--   4. movements: add tenant_id (backfill from products), tenant FK
--      RESTRICT, idx, composite FKs to products + from/to locations +
--      suppliers (nullable, MATCH SIMPLE). Leave `user_id` as a
--      single-column FK to global users. Leave `purchase_order_id` and
--      `work_order_id` as single-column FKs — those parent tables are B6
--      and B7 respectively; this batch's down does not regress them.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite
-- FK pattern). B4 introduces the NULLABLE composite FK pattern (MATCH
-- SIMPLE) used for movements.supplier_id. B5..B8 inherit it for any FK
-- column that's both tenant-scoped and nullable.

-- ─── locations (additive only) ───────────────────────────────────────────

-- B1 did not add `(tenant_id, id) UNIQUE` on locations because at the time
-- there were no composite FKs targeting it. B4 needs it now: inventory_lots,
-- inventory, and movements all install composite FKs that reference
-- locations(tenant_id, id). This is the SAME pattern B3 applied to products
-- (where supplier_products was the first composite-FK consumer). Purely
-- additive — no existing constraints change.
ALTER TABLE locations
    ADD CONSTRAINT locations_tenant_id_id_key UNIQUE (tenant_id, id);

-- ─── product_lots ────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE product_lots ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent product. Every product_lots row references
--    one product (NOT NULL FK), and products carries tenant_id post-B2.
UPDATE product_lots pl
   SET tenant_id = p.tenant_id
  FROM products p
 WHERE pl.product_id = p.id;

-- 3) Lock it down.
ALTER TABLE product_lots ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_product_lots_tenant ON product_lots(tenant_id);

-- 6) Composite uniqueness target — required because inventory_lots will
--    composite-FK to product_lots(tenant_id, id) below.
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Composite FK to products. Original FK was the default-named
--    `product_lots_product_id_fkey`. Add the composite FIRST, then drop
--    the single-column FK (add-before-drop guarantees product_id is never
--    unenforced). The original ON DELETE behavior is the default
--    (NO ACTION) — preserved here.
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE product_lots
    DROP CONSTRAINT product_lots_product_id_fkey;

-- 8) Composite FK to suppliers — NULLABLE column. MATCH SIMPLE (the
--    Postgres default) means: when ANY referencing column is NULL the FK
--    is bypassed entirely. Combined with `tenant_id NOT NULL`, this means
--    a row with `supplier_id IS NULL` skips the FK; a row with a non-null
--    supplier_id is forced to match a supplier in the same tenant.
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_supplier_tenant_fk
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES suppliers(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE product_lots
    DROP CONSTRAINT product_lots_supplier_id_fkey;

-- 9) The original `UNIQUE(product_id, lot_number)` is preserved — the
--    composite FK to products implies tenant agreement, so two rows
--    sharing (product_id, lot_number) cannot live in different tenants.

-- ─── inventory_lots ──────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE inventory_lots ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent product_lots row.
UPDATE inventory_lots il
   SET tenant_id = pl.tenant_id
  FROM product_lots pl
 WHERE il.product_lot_id = pl.id;

-- 3) Lock it down.
ALTER TABLE inventory_lots ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE inventory_lots
    ADD CONSTRAINT inventory_lots_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_inventory_lots_tenant ON inventory_lots(tenant_id);

-- 6) Composite FK to product_lots. Original FK was the default-named
--    `inventory_lots_product_lot_id_fkey` with ON DELETE CASCADE — preserved.
ALTER TABLE inventory_lots
    ADD CONSTRAINT inventory_lots_product_lot_tenant_fk
    FOREIGN KEY (tenant_id, product_lot_id)
    REFERENCES product_lots(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE inventory_lots
    DROP CONSTRAINT inventory_lots_product_lot_id_fkey;

-- 7) Composite FK to locations. Original FK was the default-named
--    `inventory_lots_location_id_fkey` (no explicit ON DELETE → defaults to
--    NO ACTION). Preserved.
ALTER TABLE inventory_lots
    ADD CONSTRAINT inventory_lots_location_tenant_fk
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES locations(tenant_id, id);

ALTER TABLE inventory_lots
    DROP CONSTRAINT inventory_lots_location_id_fkey;

-- 8) Original `UNIQUE(product_lot_id, location_id)` preserved — both refs
--    are now composite-FK'd in the same tenant, so the constraint is
--    tenant-correct without modification.

-- ─── inventory ───────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE inventory ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent product. inventory.product_id is NOT NULL
--    and FK'd to products which carries tenant_id post-B2.
UPDATE inventory i
   SET tenant_id = p.tenant_id
  FROM products p
 WHERE i.product_id = p.id;

-- 3) Lock it down.
ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE inventory
    ADD CONSTRAINT inventory_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_inventory_tenant ON inventory(tenant_id);

-- 6) Composite FK to products. Original FK was `inventory_product_id_fkey`
--    with ON DELETE CASCADE — preserved.
ALTER TABLE inventory
    ADD CONSTRAINT inventory_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE inventory
    DROP CONSTRAINT inventory_product_id_fkey;

-- 7) Composite FK to locations. Original FK was
--    `inventory_location_id_fkey` with ON DELETE CASCADE — preserved.
ALTER TABLE inventory
    ADD CONSTRAINT inventory_location_tenant_fk
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES locations(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE inventory
    DROP CONSTRAINT inventory_location_id_fkey;

-- 8) Original `UNIQUE(product_id, location_id)` preserved (composite FKs
--    imply tenant agreement, so the 2-column unique is tenant-correct).

-- ─── movements ───────────────────────────────────────────────────────────
--
-- Movements is append-only / immutable. It has FKs to:
--   * products       (NOT NULL, composite FK below)
--   * locations × 2  (from_location_id, to_location_id — both NULLABLE,
--                     composite FK with MATCH SIMPLE)
--   * users          (NOT NULL, STAYS single-column — users are global)
--   * suppliers      (NULLABLE, composite FK with MATCH SIMPLE)
--   * purchase_orders (NULLABLE, STAYS single-column — B6 retrofits)
--   * work_orders    (NULLABLE, STAYS single-column — B7 retrofits)

-- 1) Nullable tenant_id column.
ALTER TABLE movements ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent product. Every movement references a
--    product (NOT NULL FK).
UPDATE movements m
   SET tenant_id = p.tenant_id
  FROM products p
 WHERE m.product_id = p.id;

-- 3) Lock it down.
ALTER TABLE movements ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE movements
    ADD CONSTRAINT movements_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index. The existing per-column indexes
--    (idx_movements_product, idx_movements_user, etc.) are kept — they
--    serve different access patterns.
CREATE INDEX idx_movements_tenant ON movements(tenant_id);

-- 6) Composite FK to products. Original FK was the default-named
--    `movements_product_id_fkey` (no ON DELETE clause → NO ACTION).
ALTER TABLE movements
    ADD CONSTRAINT movements_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE movements
    DROP CONSTRAINT movements_product_id_fkey;

-- 7) Composite FK to from_location (NULLABLE). MATCH SIMPLE so NULLs
--    bypass the FK entirely. The original FK
--    `movements_from_location_id_fkey` (default-named, no ON DELETE)
--    likewise allowed NULLs.
ALTER TABLE movements
    ADD CONSTRAINT movements_from_location_tenant_fk
    FOREIGN KEY (tenant_id, from_location_id)
    REFERENCES locations(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE movements
    DROP CONSTRAINT movements_from_location_id_fkey;

-- 8) Composite FK to to_location (NULLABLE).
ALTER TABLE movements
    ADD CONSTRAINT movements_to_location_tenant_fk
    FOREIGN KEY (tenant_id, to_location_id)
    REFERENCES locations(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE movements
    DROP CONSTRAINT movements_to_location_id_fkey;

-- 9) Composite FK to suppliers (NULLABLE).
ALTER TABLE movements
    ADD CONSTRAINT movements_supplier_tenant_fk
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES suppliers(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE movements
    DROP CONSTRAINT movements_supplier_id_fkey;

-- 10) `user_id` (created_by) STAYS a single-column FK to global users.
--     Users are tenant-agnostic (a superadmin can act in any tenant); the
--     row's own tenant_id + Phase C RLS carry the isolation. Do NOT add
--     a composite FK to users.
--
-- 11) `purchase_order_id` (NULLABLE FK to purchase_orders) STAYS a
--     single-column FK. B6 (purchase_orders sweep) will retrofit it to
--     a composite FK.
--
-- 12) `work_order_id` (NULLABLE FK to work_orders) STAYS a single-column
--     FK with ON DELETE SET NULL. B7 (work_orders sweep) will retrofit
--     it to a composite FK. Until then there is a small window where a
--     movement could in principle reference a work_order in another
--     tenant — guarded only at the application layer. The risk is bounded
--     because only the work_orders complete-flow stamps these rows, and
--     that flow runs inside a tenant-scoped handler.
