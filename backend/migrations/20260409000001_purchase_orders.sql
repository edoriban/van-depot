-- Purchase order status enum
CREATE TYPE purchase_order_status AS ENUM (
    'draft',
    'sent',
    'partially_received',
    'completed',
    'cancelled'
);

-- Purchase orders table
CREATE TABLE purchase_orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id            UUID NOT NULL REFERENCES suppliers(id),
    order_number           VARCHAR(100) NOT NULL UNIQUE,
    status                 purchase_order_status NOT NULL DEFAULT 'draft',
    total_amount           NUMERIC(12, 2),
    expected_delivery_date DATE,
    notes                  TEXT,
    created_by             UUID NOT NULL REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purchase order lines table
CREATE TABLE purchase_order_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES products(id),
    quantity_ordered    NUMERIC(10, 3) NOT NULL CHECK (quantity_ordered > 0),
    quantity_received   NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_price          NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    notes               TEXT,
    UNIQUE (purchase_order_id, product_id)
);

-- Indexes on purchase_orders
CREATE INDEX idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status      ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_created_at  ON purchase_orders(created_at);

-- Indexes on purchase_order_lines
CREATE INDEX idx_po_lines_po_id      ON purchase_order_lines(purchase_order_id);
CREATE INDEX idx_po_lines_product_id ON purchase_order_lines(product_id);

-- Backfill columns on existing tables (nullable = zero breaking risk)
ALTER TABLE product_lots
    ADD COLUMN purchase_order_line_id UUID REFERENCES purchase_order_lines(id);

ALTER TABLE movements
    ADD COLUMN purchase_order_id UUID REFERENCES purchase_orders(id);

-- Partial indexes for traceability queries
CREATE INDEX idx_product_lots_po_line ON product_lots(purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX idx_movements_po         ON movements(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
