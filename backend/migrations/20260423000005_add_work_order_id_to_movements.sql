-- Work Orders & BOM — Migration 5/5.
-- Dedicated FK column + partial index to power the `?work_order_id=` filter
-- and detail-page back-flush grouping. Mirrors the `movements.purchase_order_id`
-- pattern from 20260409000001.
ALTER TABLE movements
    ADD COLUMN work_order_id UUID NULL REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX idx_movements_work_order
    ON movements(work_order_id)
    WHERE work_order_id IS NOT NULL;
