CREATE TYPE purchase_return_status AS ENUM (
    'pending', 'shipped_to_supplier', 'refunded', 'rejected'
);

CREATE TYPE purchase_return_reason AS ENUM (
    'damaged', 'defective', 'wrong_product', 'expired', 'excess_inventory', 'other'
);

CREATE TABLE purchase_returns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id),
    return_number       VARCHAR(100) NOT NULL UNIQUE,
    status              purchase_return_status NOT NULL DEFAULT 'pending',
    reason              purchase_return_reason NOT NULL,
    reason_notes        TEXT,
    subtotal            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total               NUMERIC(12, 2) NOT NULL DEFAULT 0,
    refund_amount       NUMERIC(12, 2),
    decrease_inventory  BOOLEAN NOT NULL DEFAULT TRUE,
    requested_by_id     UUID NOT NULL REFERENCES users(id),
    shipped_at          TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_return_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_return_id  UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES products(id),
    quantity_returned   NUMERIC(10, 3) NOT NULL CHECK (quantity_returned > 0),
    quantity_original   NUMERIC(10, 3) NOT NULL CHECK (quantity_original > 0),
    unit_price          NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    subtotal            NUMERIC(12, 2) NOT NULL,
    UNIQUE (purchase_return_id, product_id)
);

CREATE INDEX idx_purchase_returns_po_id ON purchase_returns(purchase_order_id);
CREATE INDEX idx_purchase_returns_status ON purchase_returns(status);
