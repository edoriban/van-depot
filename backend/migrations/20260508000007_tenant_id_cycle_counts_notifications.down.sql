-- Down for 20260508000007_tenant_id_cycle_counts_notifications.sql
-- Reverses every operation in REVERSE table order:
-- notifications → cycle_count_items → cycle_counts.
--
-- Inside each table, restore single-column FKs BEFORE dropping composites
-- so the columns are continuously enforced.

-- ─── notifications: drop indexes + tenant FK + column ────────────────────

DROP INDEX IF EXISTS idx_notifications_user_tenant_created;
DROP INDEX IF EXISTS idx_notifications_tenant;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_tenant_fk;
ALTER TABLE notifications DROP COLUMN IF EXISTS tenant_id;

-- ─── cycle_count_items: restore single-column FKs, drop composites ───────

ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations(id);

ALTER TABLE cycle_count_items DROP CONSTRAINT IF EXISTS cycle_count_items_location_tenant_fk;

ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE cycle_count_items DROP CONSTRAINT IF EXISTS cycle_count_items_product_tenant_fk;

ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_cycle_count_id_fkey
    FOREIGN KEY (cycle_count_id) REFERENCES cycle_counts(id) ON DELETE CASCADE;

ALTER TABLE cycle_count_items DROP CONSTRAINT IF EXISTS cycle_count_items_cc_tenant_fk;

DROP INDEX IF EXISTS idx_cycle_count_items_tenant;
ALTER TABLE cycle_count_items DROP CONSTRAINT IF EXISTS cycle_count_items_tenant_fk;
ALTER TABLE cycle_count_items DROP COLUMN IF EXISTS tenant_id;

-- ─── cycle_counts: restore single-column FK, drop composites ─────────────

ALTER TABLE cycle_counts
    ADD CONSTRAINT cycle_counts_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

ALTER TABLE cycle_counts DROP CONSTRAINT IF EXISTS cycle_counts_warehouse_tenant_fk;

ALTER TABLE cycle_counts DROP CONSTRAINT IF EXISTS cycle_counts_tenant_id_id_key;
DROP INDEX IF EXISTS idx_cycle_counts_tenant;
ALTER TABLE cycle_counts DROP CONSTRAINT IF EXISTS cycle_counts_tenant_fk;
ALTER TABLE cycle_counts DROP COLUMN IF EXISTS tenant_id;
