-- Multi-Tenant Foundation — Phase B Batch 8.2
-- Makes `stock_configuration` per-tenant. Replaces the original "global
-- defaults" pattern (single row with warehouse_id NULL + product_id NULL)
-- with PER-TENANT defaults (one such row per tenant).
--
-- B8.2 introduces a NEW pattern relative to B1..B7: NULLABLE composite FKs
-- with MATCH SIMPLE.
--
-- Schema before B8.2 (from initial_schema.sql lines 67-94):
--   stock_configuration(id, warehouse_id NULLABLE, product_id NULLABLE, ...)
--   warehouse_id -> warehouses(id) ON DELETE CASCADE
--   product_id   -> products(id)   ON DELETE CASCADE
--   Unique partials:
--     idx_stock_config_global    UNIQUE on ((1)) WHERE both NULL
--     idx_stock_config_warehouse UNIQUE on (warehouse_id) WHERE per-warehouse
--     idx_stock_config_product   UNIQUE on (product_id)   WHERE per-product
--
-- Schema after B8.2:
--   stock_configuration(tenant_id NOT NULL, warehouse_id NULLABLE, product_id NULLABLE, ...)
--   tenant_id -> tenants(id) ON DELETE RESTRICT
--   (tenant_id, warehouse_id) -> warehouses(tenant_id, id) MATCH SIMPLE ON DELETE CASCADE
--   (tenant_id, product_id)   -> products(tenant_id, id)   MATCH SIMPLE ON DELETE CASCADE
--   Replacement uniqueness: UNIQUE NULLS NOT DISTINCT (tenant_id, warehouse_id, product_id)
--     — collapses the 3 partial uniques into one tenant-scoped constraint.
--     `NULLS NOT DISTINCT` (Postgres 15+) treats NULL = NULL for uniqueness,
--     so a tenant can have AT MOST ONE row with both warehouse_id NULL +
--     product_id NULL (per-tenant global default), AT MOST ONE per
--     (warehouse_id) when product_id is NULL, AT MOST ONE per (product_id)
--     when warehouse_id is NULL, AND AT MOST ONE per (warehouse_id,
--     product_id) when both are set.
--
-- MATCH SIMPLE on the composite FKs: when ALL referencing columns are NULL,
-- the FK is NOT checked (this is the SQL default; we make it explicit). This
-- is what allows a global-per-tenant row (warehouse_id NULL + product_id
-- NULL + tenant_id set) to exist — only `tenant_id` is checked against the
-- tenants FK, and the composite (tenant_id, warehouse_id)/(tenant_id,
-- product_id) FKs are skipped because warehouse_id/product_id are NULL.
--
-- When PARTIALLY NULL (one set, one NULL), MATCH SIMPLE still skips the
-- composite — but we don't have any "global" rows with one of the two set
-- and the other NULL EXCEPT for per-warehouse (warehouse_id set,
-- product_id NULL) and per-product (warehouse_id NULL, product_id set).
-- For those cases the composite FK that has the SET column DOES fire (because
-- both columns of THAT specific FK are non-NULL: tenant_id is always set,
-- warehouse_id is set in the per-warehouse case, etc.).
--
-- Backfill strategy:
--   - Rows with warehouse_id set: derive tenant_id from
--     warehouses.tenant_id.
--   - Rows with product_id set (and warehouse_id NULL): derive from
--     products.tenant_id.
--   - Rows with both NULL (the original "truly global" rows): assign
--     `dev` tenant. There's no "right" answer here — drop-and-reseed
--     approved per Phase B charter, no customer data on dev DB.
--   - In production (post Phase D), every new tenant gets its global row
--     created via `replicate_stock_config_for_tenant` (B8.3 helper).

-- ─── stock_configuration ─────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE stock_configuration ADD COLUMN tenant_id UUID;

-- 2) Backfill: warehouse-derived first, then product-derived, then `dev` tenant.
--    Order matters — the warehouse derivation runs first so per-warehouse
--    rows pick up the correct tenant even if the product (when set) lives
--    in a different tenant. With `dev` as the only pre-B8 tenant, this
--    is a no-op tiebreak.
UPDATE stock_configuration sc
   SET tenant_id = w.tenant_id
  FROM warehouses w
 WHERE sc.warehouse_id = w.id
   AND sc.tenant_id IS NULL;

UPDATE stock_configuration sc
   SET tenant_id = p.tenant_id
  FROM products p
 WHERE sc.product_id = p.id
   AND sc.tenant_id IS NULL;

UPDATE stock_configuration
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev')
 WHERE tenant_id IS NULL;

-- 3) Lock it down.
ALTER TABLE stock_configuration ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT. Deleting a tenant with config rows should
--    require explicit cleanup.
ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Composite FK to warehouses — MATCH SIMPLE preserves the original
--    nullable semantics (a row may have warehouse_id NULL = "applies to
--    every warehouse in this tenant"). ON DELETE CASCADE preserved (kill
--    the warehouse → kill its overrides).
ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_warehouse_tenant_fk
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES warehouses(tenant_id, id)
    MATCH SIMPLE
    ON DELETE CASCADE;

ALTER TABLE stock_configuration
    DROP CONSTRAINT stock_configuration_warehouse_id_fkey;

-- 6) Composite FK to products — MATCH SIMPLE for the same reason. ON
--    DELETE CASCADE preserved.
ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    MATCH SIMPLE
    ON DELETE CASCADE;

ALTER TABLE stock_configuration
    DROP CONSTRAINT stock_configuration_product_id_fkey;

-- 7) Replace the original three partial UNIQUE indexes with a single
--    tenant-scoped uniqueness using `NULLS NOT DISTINCT`. This treats
--    NULL = NULL for uniqueness purposes, which is exactly what we need:
--      (T, NULL,  NULL ) — one global default per tenant
--      (T, W,     NULL ) — one per-warehouse default per tenant
--      (T, NULL,  P    ) — one per-product default per tenant
--      (T, W,     P    ) — one specific per tenant
ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_tenant_warehouse_product_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, warehouse_id, product_id);

DROP INDEX idx_stock_config_global;
DROP INDEX idx_stock_config_warehouse;
DROP INDEX idx_stock_config_product;

-- 8) Tenant-scoped lookup index.
CREATE INDEX idx_stock_configuration_tenant ON stock_configuration(tenant_id);
