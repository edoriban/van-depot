-- Multi-Tenant Foundation — Phase B Batch 3
-- Adds `tenant_id` to `suppliers` and `supplier_products`. Suppliers FIRST so
-- supplier_products' composite FK has a target. Products is touched only to
-- add an additive `(tenant_id, id) UNIQUE` (B2 did not add it because the
-- first composite-FK target wasn't needed yet — B3's supplier_products
-- composite FK to products needs it now).
--
-- B3 introduces the JUNCTION-TABLE composite-FK pattern (NEW relative to
-- B1/B2):
--   * `supplier_products` is a many-to-many join. We replace BOTH its
--     single-column FKs (→ suppliers, → products) with composite FKs
--     `(tenant_id, supplier_id) → suppliers(tenant_id, id)` and
--     `(tenant_id, product_id) → products(tenant_id, id)`. The composite
--     FKs are the canonical cross-tenant integrity check: no row of
--     `supplier_products` can ever bind a supplier and a product from
--     different tenants. The application predicate is belt-and-suspenders.
--   * Junction-table uniqueness `(supplier_id, product_id)` is already
--     tenant-implied by the composite FKs (both refs share tenant_id); no
--     change needed to the existing UNIQUE constraint.
--
-- Operation order (per B1/B2 template):
--   suppliers   → add tenant_id → backfill → NOT NULL → FK RESTRICT →
--                  idx_*_tenant → (tenant_id, id) UNIQUE → name UNIQUE
--                  (partial — no UNIQUE on name in initial_schema, but we
--                  install a tenant-scoped one for cross-tenant collision
--                  isolation per design §3.2).
--   products    → ADDITIVE (tenant_id, id) UNIQUE only (B2 missed it; this
--                  is the FK target supplier_products needs).
--   supplier_products → add tenant_id → backfill from suppliers parent →
--                  NOT NULL → FK RESTRICT → idx_*_tenant → DROP
--                  single-column FKs → ADD composite FKs to BOTH parents.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite
-- FK pattern for junction tables). B3 is the TEMPLATE for B6
-- (purchase_order_lines), B7 (cycle_count_items), and other join tables.

-- ─── suppliers ───────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE suppliers ADD COLUMN tenant_id UUID;

-- 2) Backfill from the seeded `dev` tenant. (Drop-and-reseed approved per
--    Phase B charter — no customer data on dev DB.)
UPDATE suppliers
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE suppliers ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT (deleting a tenant with suppliers must be
--    explicit; cascading would silently nuke the catalog).
ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id);

-- 6) Composite uniqueness target — required as the parent side of
--    `supplier_products(tenant_id, supplier_id) → suppliers(tenant_id, id)`
--    (composite FK installed below). The PK on `id` already guarantees row
--    uniqueness on its own; this is purely the FK-target dance.
ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Tenant-scoped name uniqueness — original schema had NO UNIQUE on
--    `suppliers.name` (`initial_schema.sql:104-113` only declares the PK).
--    Install a tenant-scoped one so two tenants can both have a supplier
--    named "Aceros Monterrey" but a single tenant cannot duplicate the
--    same name. Suppliers has NO `deleted_at` column (hard delete only),
--    so we use `NULLS NOT DISTINCT` plain UNIQUE rather than a partial
--    `WHERE deleted_at IS NULL` index. Postgres 17 supports this natively.
ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_tenant_name_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, name);

-- ─── products (additive only) ────────────────────────────────────────────

-- B2 did not add `(tenant_id, id) UNIQUE` because at the time there were no
-- composite FKs targeting it. supplier_products needs it now, so add it
-- here. This is purely additive — no existing constraints change.
ALTER TABLE products
    ADD CONSTRAINT products_tenant_id_id_key UNIQUE (tenant_id, id);

-- ─── supplier_products ───────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE supplier_products ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent supplier. supplier_products is a true
--    junction table: every row references one supplier and one product. We
--    derive tenant_id from the supplier; the composite FK to products
--    (installed below) enforces that the product's tenant_id matches, so
--    if the supplier and product disagreed on tenant the FK addition
--    further down would fail loud. With `dev` as the only pre-B3 tenant
--    they must agree.
UPDATE supplier_products sp
   SET tenant_id = s.tenant_id
  FROM suppliers s
 WHERE sp.supplier_id = s.id;

-- 3) Lock it down.
ALTER TABLE supplier_products ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT (consistent with parents).
ALTER TABLE supplier_products
    ADD CONSTRAINT supplier_products_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_supplier_products_tenant ON supplier_products(tenant_id);

-- 6) Composite FK to suppliers — replaces the original single-column FK
--    (`supplier_management.sql:7`: `supplier_id UUID NOT NULL REFERENCES
--    suppliers(id) ON DELETE CASCADE`). Add the composite BEFORE dropping
--    the single-column FK so supplier_id is never unenforced. ON DELETE
--    CASCADE preserved (junction-table convention — kill the supplier,
--    kill its catalog entries).
ALTER TABLE supplier_products
    ADD CONSTRAINT supplier_products_supplier_tenant_fk
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES suppliers(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE supplier_products
    DROP CONSTRAINT supplier_products_supplier_id_fkey;

-- 7) Composite FK to products — replaces the original single-column FK
--    (`supplier_management.sql:8`: `product_id UUID NOT NULL REFERENCES
--    products(id) ON DELETE CASCADE`). Same add-before-drop ordering.
ALTER TABLE supplier_products
    ADD CONSTRAINT supplier_products_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE supplier_products
    DROP CONSTRAINT supplier_products_product_id_fkey;

-- 8) The original `UNIQUE(supplier_id, product_id)` constraint
--    (`supplier_management.sql:17`) is already tenant-implied by the
--    composite FKs above (both refs share tenant_id, so two rows with the
--    same `supplier_id, product_id` must share `tenant_id` too). No
--    change needed — within-tenant uniqueness is preserved, and
--    cross-tenant collisions are impossible by construction.
