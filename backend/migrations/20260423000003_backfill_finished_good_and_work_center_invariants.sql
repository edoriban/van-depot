-- Work Orders & BOM — Migration 3/5.
-- Finished-good invariants + work-center CHECK + idempotent backfill.
-- Runs as a separate sqlx transaction from 20260423000002, so the new enum
-- values `work_center` and `finished_good` are free to reference here.

-- 1. Semantic-protection tie: both new types MUST be system-managed.
--    Mirrors chk_reception_is_system from 20260418000002.
ALTER TABLE locations
    ADD CONSTRAINT chk_work_center_is_system
    CHECK (location_type <> 'work_center' OR is_system = true);

ALTER TABLE locations
    ADD CONSTRAINT chk_finished_good_is_system
    CHECK (location_type <> 'finished_good' OR is_system = true);

-- 2. Exactly one finished_good per warehouse (partial unique index).
--    locations has no deleted_at column — it's a live-only table. The Recepción
--    precedent (idx_one_reception_per_warehouse) omits the deleted_at predicate
--    for the same reason.
CREATE UNIQUE INDEX idx_one_finished_good_per_warehouse
    ON locations (warehouse_id)
    WHERE location_type = 'finished_good' AND is_system = true;

-- 3. Idempotent backfill: one `Producto Terminado` per existing active warehouse.
--    Matches the Recepción backfill (20260418000002 §4) exactly.
INSERT INTO locations
    (warehouse_id, location_type, name, label, is_system, pos_x, pos_y, width, height)
SELECT w.id, 'finished_good', 'Producto Terminado', 'PT', true, 0, 0, 100, 100
FROM warehouses w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM locations l
      WHERE l.warehouse_id = w.id
        AND l.location_type = 'finished_good'
        AND l.is_system = true
  );

-- NOTE: work_center has NO auto-backfill — operators provision via the UI.
-- NOTE: the CHECK constraints reference the new enum values added in
--       20260423000002; they commit in this separate sqlx transaction.
