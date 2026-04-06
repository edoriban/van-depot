-- Quality status enum for product lots
CREATE TYPE quality_status AS ENUM ('pending', 'approved', 'rejected', 'quarantine');

-- 1. Supplier Products catalog (which suppliers sell which products)
CREATE TABLE supplier_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    supplier_sku VARCHAR(100),
    unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
    lead_time_days INT NOT NULL DEFAULT 0,
    minimum_order_qty DECIMAL(12,4) NOT NULL DEFAULT 1,
    is_preferred BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(supplier_id, product_id)
);

CREATE TRIGGER supplier_products_updated_at BEFORE UPDATE ON supplier_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product ON supplier_products(product_id);

-- 2. Product Lots (batch/lot tracking per product)
CREATE TABLE product_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    lot_number VARCHAR(100) NOT NULL,
    batch_date DATE,
    expiration_date DATE,
    supplier_id UUID REFERENCES suppliers(id),
    received_quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
    quality_status quality_status NOT NULL DEFAULT 'approved',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, lot_number)
);

CREATE TRIGGER product_lots_updated_at BEFORE UPDATE ON product_lots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_product_lots_product ON product_lots(product_id);
CREATE INDEX idx_product_lots_expiration ON product_lots(expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX idx_product_lots_status ON product_lots(quality_status);

-- 3. Inventory by Lot (stock per lot per location)
CREATE TABLE inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_lot_id UUID NOT NULL REFERENCES product_lots(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id),
    quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_lot_id, location_id)
);

CREATE TRIGGER inventory_lots_updated_at BEFORE UPDATE ON inventory_lots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_inventory_lots_lot ON inventory_lots(product_lot_id);
CREATE INDEX idx_inventory_lots_location ON inventory_lots(location_id);

-- 4. Stock Configuration (global, per-warehouse, or per-product thresholds)
CREATE TABLE stock_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    default_min_stock DECIMAL(12,4) NOT NULL DEFAULT 10,
    critical_stock_multiplier DECIMAL(4,2) NOT NULL DEFAULT 0.5,
    low_stock_multiplier DECIMAL(4,2) NOT NULL DEFAULT 0.75,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER stock_configuration_updated_at BEFORE UPDATE ON stock_configuration
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Global config: warehouse_id IS NULL AND product_id IS NULL (at most 1 row)
CREATE UNIQUE INDEX idx_stock_config_global
    ON stock_configuration ((1))
    WHERE warehouse_id IS NULL AND product_id IS NULL;

-- Per-warehouse config: product_id IS NULL
CREATE UNIQUE INDEX idx_stock_config_warehouse
    ON stock_configuration (warehouse_id)
    WHERE warehouse_id IS NOT NULL AND product_id IS NULL;

-- Per-product config: warehouse_id IS NULL
CREATE UNIQUE INDEX idx_stock_config_product
    ON stock_configuration (product_id)
    WHERE product_id IS NOT NULL AND warehouse_id IS NULL;

-- 5. Add movement_reason to movements table
ALTER TABLE movements ADD COLUMN movement_reason VARCHAR(50);

CREATE INDEX idx_movements_reason ON movements(movement_reason) WHERE movement_reason IS NOT NULL;
