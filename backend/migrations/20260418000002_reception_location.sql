-- Migration B: introduce the `is_system` protection flag, enforce one reception per
-- warehouse via a partial unique index, and backfill a Recepción row for every active
-- warehouse that lacks one. Must run AFTER the enum variant was added and committed
-- (see 20260418000001_add_reception_location_type.sql).

-- 1. Protection flag
ALTER TABLE locations
    ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

-- 2. Semantic-protection tie: rows of type 'reception' MUST be system-managed.
ALTER TABLE locations
    ADD CONSTRAINT chk_reception_is_system
    CHECK (location_type != 'reception' OR is_system = true);

-- 3. One reception per warehouse (partial unique index).
CREATE UNIQUE INDEX idx_one_reception_per_warehouse
    ON locations (warehouse_id)
    WHERE location_type = 'reception';

-- 4. Idempotent backfill: one Recepción per existing active warehouse.
-- Uses NOT EXISTS so re-running the migration yields zero new rows.
INSERT INTO locations
    (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
SELECT w.id, 'reception', 'Recepción', 'RCP', true, 0, 0, 100, 100
FROM warehouses w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM locations l
      WHERE l.warehouse_id = w.id
        AND l.location_type = 'reception'
  );
