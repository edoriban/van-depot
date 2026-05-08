-- Down for 20260508000001_tenant_id_warehouses_locations.sql
-- Reverses every operation in REVERSE order. Decision: we DO drop the
-- `warehouses_tenant_id_id_key` UNIQUE constraint — keeping it would leave a
-- dangling artifact that B8 can re-add deterministically (composite FK target
-- for `user_warehouses`). The down therefore returns the schema to the
-- exact pre-B1 shape.

-- ─── locations: restore single-column FK, drop composite, drop tenant ────

-- Re-add the original single-column FK on warehouse_id (CASCADE matches
-- initial schema). Add it BEFORE dropping the composite so warehouse_id is
-- continuously enforced.
ALTER TABLE locations
    ADD CONSTRAINT locations_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_warehouse_tenant_fk;

DROP INDEX IF EXISTS idx_locations_tenant;
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_tenant_fk;
ALTER TABLE locations DROP COLUMN IF EXISTS tenant_id;

-- ─── warehouses: drop composite uniques, FK, indexes, column ─────────────

ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_tenant_id_id_key;
DROP INDEX IF EXISTS warehouses_tenant_name_key;
DROP INDEX IF EXISTS idx_warehouses_tenant;
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_tenant_fk;
ALTER TABLE warehouses DROP COLUMN IF EXISTS tenant_id;
