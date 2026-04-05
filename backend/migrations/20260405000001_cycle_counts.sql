-- Cycle count status enum
CREATE TYPE cycle_count_status AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');

-- Cycle count sessions
CREATE TABLE cycle_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    name VARCHAR(255) NOT NULL,
    status cycle_count_status NOT NULL DEFAULT 'draft',
    created_by UUID NOT NULL REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER cycle_counts_updated_at BEFORE UPDATE ON cycle_counts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Individual count items (one per product+location in the count)
CREATE TABLE cycle_count_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_count_id UUID NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    system_quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
    counted_quantity DECIMAL(12,4),
    variance DECIMAL(12,4),
    counted_by UUID REFERENCES users(id),
    counted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cycle_count_id, product_id, location_id)
);

CREATE INDEX idx_cycle_counts_warehouse ON cycle_counts(warehouse_id);
CREATE INDEX idx_cycle_counts_status ON cycle_counts(status);
CREATE INDEX idx_cycle_count_items_count ON cycle_count_items(cycle_count_id);
