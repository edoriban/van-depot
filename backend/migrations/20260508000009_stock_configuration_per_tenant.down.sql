-- Down for 20260508000009_stock_configuration_per_tenant.sql
-- Reverses every operation in inverse order: indexes/uniques restored →
-- composites dropped → single-column FKs restored → tenant FK/column dropped.

DROP INDEX IF EXISTS idx_stock_configuration_tenant;

-- Restore the three original partial UNIQUE indexes.
CREATE UNIQUE INDEX idx_stock_config_global
    ON stock_configuration ((1))
    WHERE warehouse_id IS NULL AND product_id IS NULL;

CREATE UNIQUE INDEX idx_stock_config_warehouse
    ON stock_configuration (warehouse_id)
    WHERE warehouse_id IS NOT NULL AND product_id IS NULL;

CREATE UNIQUE INDEX idx_stock_config_product
    ON stock_configuration (product_id)
    WHERE product_id IS NOT NULL AND warehouse_id IS NULL;

ALTER TABLE stock_configuration
    DROP CONSTRAINT IF EXISTS stock_configuration_tenant_warehouse_product_key;

-- Restore single-column FKs first, then drop composites (column-FK is
-- never unenforced).
ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE stock_configuration
    DROP CONSTRAINT IF EXISTS stock_configuration_product_tenant_fk;

ALTER TABLE stock_configuration
    ADD CONSTRAINT stock_configuration_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

ALTER TABLE stock_configuration
    DROP CONSTRAINT IF EXISTS stock_configuration_warehouse_tenant_fk;

ALTER TABLE stock_configuration DROP CONSTRAINT IF EXISTS stock_configuration_tenant_fk;
ALTER TABLE stock_configuration DROP COLUMN IF EXISTS tenant_id;
