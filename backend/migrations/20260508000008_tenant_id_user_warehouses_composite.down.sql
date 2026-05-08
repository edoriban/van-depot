-- Down for 20260508000008_tenant_id_user_warehouses_composite.sql
-- Reverses the operations in inverse order:
--   indexes → PK swap → user_id-only FK preserved → composite FKs dropped →
--   single-column FK restored → tenant FK + column dropped.

DROP INDEX IF EXISTS idx_user_warehouses_tenant_warehouse;
DROP INDEX IF EXISTS idx_user_warehouses_user;

-- Restore PK (user_id, warehouse_id).
ALTER TABLE user_warehouses DROP CONSTRAINT IF EXISTS user_warehouses_pkey;
ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_pkey PRIMARY KEY (user_id, warehouse_id);

-- Restore the single-column FK on warehouse_id BEFORE dropping the
-- composites so the column is never unenforced.
ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

ALTER TABLE user_warehouses DROP CONSTRAINT IF EXISTS user_warehouses_user_tenant_fk;
ALTER TABLE user_warehouses DROP CONSTRAINT IF EXISTS user_warehouses_warehouse_tenant_fk;

ALTER TABLE user_warehouses DROP CONSTRAINT IF EXISTS user_warehouses_tenant_fk;
ALTER TABLE user_warehouses DROP COLUMN IF EXISTS tenant_id;
