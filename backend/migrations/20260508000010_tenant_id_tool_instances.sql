-- Multi-Tenant Foundation — Phase B Batch 8 (EXTRA: tool_instances)
-- Adds `tenant_id` to `tool_instances`. Originally scoped to B7 but deferred
-- there — see B7 apply-progress.
--
-- `tool_instances` is tenant-coupled because BOTH parents are tenant-scoped:
--   product_id  (NOT NULL) -> products(id)   — tenant-scoped post-B2
--   location_id (NULLABLE) -> locations(id)  — tenant-scoped post-B1
--
-- Schema before:
--   tool_instances(id, product_id, serial, status, location_id, created_at, updated_at)
--   product_id  -> products(id)   NOT NULL
--   location_id -> locations(id)  NULLABLE
--   UNIQUE (product_id, serial)   — global, should be tenant-scoped
--
-- Schema after:
--   tool_instances(id, tenant_id NOT NULL, product_id, serial, status, location_id, ...)
--   tenant_id -> tenants(id) ON DELETE RESTRICT
--   (tenant_id, product_id) -> products(tenant_id, id)
--   (tenant_id, location_id) -> locations(tenant_id, id) MATCH SIMPLE
--   UNIQUE (tenant_id, product_id, serial)
--
-- Pattern follows B7 (cycle_count_items): composite FKs to BOTH parents,
-- tenant-scoped uniqueness on the natural key. NULLABLE composite FK on
-- (tenant_id, location_id) uses MATCH SIMPLE to allow rows with
-- location_id NULL ("not currently parked anywhere"); B4 added the
-- `(tenant_id, id) UNIQUE` constraint on locations needed for this composite
-- FK target. B3 added `(tenant_id, id) UNIQUE` on products.

-- ─── tool_instances ──────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE tool_instances ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent product (product_id is NOT NULL and
--    products.tenant_id is NOT NULL post-B2).
UPDATE tool_instances ti
   SET tenant_id = p.tenant_id
  FROM products p
 WHERE ti.product_id = p.id;

-- 3) Lock it down.
ALTER TABLE tool_instances ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE tool_instances
    ADD CONSTRAINT tool_instances_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_tool_instances_tenant ON tool_instances(tenant_id);

-- 6) Composite FK to products (NOT NULL) — replaces the original
--    `tool_instances_product_id_fkey` (no explicit ON DELETE → NO ACTION).
--    Add-before-drop.
ALTER TABLE tool_instances
    ADD CONSTRAINT tool_instances_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE tool_instances
    DROP CONSTRAINT tool_instances_product_id_fkey;

-- 7) Composite FK to locations (NULLABLE) — MATCH SIMPLE allows
--    location_id NULL while still enforcing tenant agreement when set.
--    Replaces the original `tool_instances_location_id_fkey` (no explicit
--    ON DELETE → NO ACTION).
ALTER TABLE tool_instances
    ADD CONSTRAINT tool_instances_location_tenant_fk
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES locations(tenant_id, id)
    MATCH SIMPLE;

ALTER TABLE tool_instances
    DROP CONSTRAINT tool_instances_location_id_fkey;

-- 8) Replace the global `UNIQUE(product_id, serial)` with a tenant-scoped
--    `UNIQUE(tenant_id, product_id, serial)`. Two tenants can now both
--    issue serial 'XYZ-001' for the same SKU pattern; within a single
--    tenant the natural key remains enforced.
--
--    The original constraint was named
--    `uq_tool_instances_product_serial` per the create-tool-instances
--    migration.
ALTER TABLE tool_instances
    DROP CONSTRAINT uq_tool_instances_product_serial;

ALTER TABLE tool_instances
    ADD CONSTRAINT uq_tool_instances_tenant_product_serial
    UNIQUE (tenant_id, product_id, serial);
