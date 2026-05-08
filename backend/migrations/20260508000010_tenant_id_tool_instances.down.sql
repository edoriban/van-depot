-- Down for 20260508000010_tenant_id_tool_instances.sql
-- Reverses operations in inverse order.

-- Restore the original UNIQUE before dropping the tenant-scoped one.
ALTER TABLE tool_instances
    ADD CONSTRAINT uq_tool_instances_product_serial
    UNIQUE (product_id, serial);

ALTER TABLE tool_instances
    DROP CONSTRAINT IF EXISTS uq_tool_instances_tenant_product_serial;

-- Restore single-column FK to locations BEFORE dropping the composite.
ALTER TABLE tool_instances
    ADD CONSTRAINT tool_instances_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations(id);

ALTER TABLE tool_instances
    DROP CONSTRAINT IF EXISTS tool_instances_location_tenant_fk;

-- Restore single-column FK to products BEFORE dropping the composite.
ALTER TABLE tool_instances
    ADD CONSTRAINT tool_instances_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE tool_instances
    DROP CONSTRAINT IF EXISTS tool_instances_product_tenant_fk;

DROP INDEX IF EXISTS idx_tool_instances_tenant;
ALTER TABLE tool_instances DROP CONSTRAINT IF EXISTS tool_instances_tenant_fk;
ALTER TABLE tool_instances DROP COLUMN IF EXISTS tenant_id;
