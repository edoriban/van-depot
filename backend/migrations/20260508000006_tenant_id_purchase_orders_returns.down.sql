-- Down for 20260508000006_tenant_id_purchase_orders_returns.sql
-- Reverses every operation in REVERSE table order: product_lots and
-- movements retrofits first, then purchase_return_items →
-- purchase_returns → purchase_order_lines → purchase_orders LAST.
--
-- Inside each table, restore single-column FKs BEFORE dropping
-- composites so the columns are continuously enforced.

-- ─── product_lots.purchase_order_line_id retrofit reversal ───────────────

-- Restore single-column FK (no ON DELETE clause, matching original).
ALTER TABLE product_lots
    ADD CONSTRAINT product_lots_purchase_order_line_id_fkey
    FOREIGN KEY (purchase_order_line_id) REFERENCES purchase_order_lines(id);

ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_po_line_tenant_fk;

-- ─── movements.purchase_order_id retrofit reversal ───────────────────────

-- Restore single-column FK (no ON DELETE clause, matching original).
ALTER TABLE movements
    ADD CONSTRAINT movements_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_purchase_order_tenant_fk;

-- ─── purchase_return_items: restore single-column FKs, drop composites ───

ALTER TABLE purchase_return_items
    ADD CONSTRAINT purchase_return_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE purchase_return_items DROP CONSTRAINT IF EXISTS purchase_return_items_product_tenant_fk;

ALTER TABLE purchase_return_items
    ADD CONSTRAINT purchase_return_items_purchase_return_id_fkey
    FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE;

ALTER TABLE purchase_return_items DROP CONSTRAINT IF EXISTS purchase_return_items_pr_tenant_fk;

DROP INDEX IF EXISTS idx_purchase_return_items_tenant;
ALTER TABLE purchase_return_items DROP CONSTRAINT IF EXISTS purchase_return_items_tenant_fk;
ALTER TABLE purchase_return_items DROP COLUMN IF EXISTS tenant_id;

-- ─── purchase_returns: restore single-column FKs, drop composites + UNIQUE

ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);

ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_po_tenant_fk;

-- Restore the global `(return_number)` UNIQUE.
ALTER TABLE purchase_returns
    ADD CONSTRAINT purchase_returns_return_number_key UNIQUE (return_number);

ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_tenant_return_number_key;

ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_tenant_id_id_key;
DROP INDEX IF EXISTS idx_purchase_returns_tenant;
ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_tenant_fk;
ALTER TABLE purchase_returns DROP COLUMN IF EXISTS tenant_id;

-- ─── purchase_order_lines: restore single-column FKs, drop composites ────

ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_product_tenant_fk;

ALTER TABLE purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_po_tenant_fk;

ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_id_id_key;
DROP INDEX IF EXISTS idx_purchase_order_lines_tenant;
ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_fk;
ALTER TABLE purchase_order_lines DROP COLUMN IF EXISTS tenant_id;

-- ─── purchase_orders: restore single-column FKs, drop composites + UNIQUE ─

ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_supplier_tenant_fk;

-- Restore the global `(order_number)` UNIQUE.
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_order_number_key UNIQUE (order_number);

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_tenant_order_number_key;

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_tenant_id_id_key;
DROP INDEX IF EXISTS idx_purchase_orders_tenant;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_tenant_fk;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS tenant_id;
