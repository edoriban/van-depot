-- Work Orders & BOM — Migration 4/5.
-- New enum + work_orders header table + work_order_materials line table.

CREATE TYPE work_order_status AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');

CREATE TABLE work_orders (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     VARCHAR(50) NOT NULL UNIQUE,
    recipe_id                UUID NOT NULL REFERENCES recipes(id),
    fg_product_id            UUID NOT NULL REFERENCES products(id),
    fg_quantity              DECIMAL(12,4) NOT NULL CHECK (fg_quantity > 0),
    status                   work_order_status NOT NULL DEFAULT 'draft',
    warehouse_id             UUID NOT NULL REFERENCES warehouses(id),
    work_center_location_id  UUID NOT NULL REFERENCES locations(id),
    notes                    TEXT,
    created_by               UUID NOT NULL REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    issued_at                TIMESTAMPTZ,
    completed_at             TIMESTAMPTZ,
    cancelled_at             TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
);

CREATE TRIGGER work_orders_updated_at
    BEFORE UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_work_orders_status      ON work_orders(status)                  WHERE deleted_at IS NULL;
CREATE INDEX idx_work_orders_warehouse   ON work_orders(warehouse_id);
CREATE INDEX idx_work_orders_work_center ON work_orders(work_center_location_id);
CREATE INDEX idx_work_orders_fg_product  ON work_orders(fg_product_id);
CREATE INDEX idx_work_orders_recipe      ON work_orders(recipe_id);
CREATE INDEX idx_work_orders_created     ON work_orders(created_at);

CREATE TABLE work_order_materials (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id      UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    product_id         UUID NOT NULL REFERENCES products(id),
    quantity_expected  DECIMAL(12,4) NOT NULL CHECK (quantity_expected > 0),
    quantity_consumed  DECIMAL(12,4) NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
    notes              VARCHAR(255),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(work_order_id, product_id)
);

CREATE INDEX idx_work_order_materials_wo      ON work_order_materials(work_order_id);
CREATE INDEX idx_work_order_materials_product ON work_order_materials(product_id);

-- NOTE: no lot_id column on work_order_materials by design (§D7): FEFO lot
-- picking happens at COMPLETE, not at ISSUE, so no reservation is persisted.
