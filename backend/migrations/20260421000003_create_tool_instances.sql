-- Migration C: scaffold table for discrete tool/spare instances, tracked by
-- serial per product. No API endpoints reference this table yet; the
-- tools-and-spares-flow change will own the read/write UX.

CREATE TABLE tool_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    serial TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'in_use', 'maintenance', 'retired')),
    location_id UUID REFERENCES locations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_tool_instances_product_serial UNIQUE (product_id, serial)
);

CREATE TRIGGER tool_instances_updated_at BEFORE UPDATE ON tool_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_tool_instances_product_id ON tool_instances (product_id);
CREATE INDEX idx_tool_instances_location_id ON tool_instances (location_id);
CREATE INDEX idx_tool_instances_status ON tool_instances (status);
