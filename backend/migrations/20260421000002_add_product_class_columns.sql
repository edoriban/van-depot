-- Migration B: add product_class + has_expiry columns to products, enforce the
-- class/expiry invariant, and create a partial index for the class filter.
-- Must run AFTER the enum type was added and committed (see
-- 20260421000001_add_product_class_enum.sql).

-- 1. Add product_class column with backfill default. The DEFAULT stays in place
--    so factory-based tests and any existing INSERT statements that do not yet
--    supply product_class continue to work; the seed explicitly sets per-SKU
--    values so demo data does not rely on the default.
ALTER TABLE products
    ADD COLUMN product_class product_class NOT NULL DEFAULT 'raw_material';

-- 2. Add sibling has_expiry boolean.
ALTER TABLE products
    ADD COLUMN has_expiry BOOLEAN NOT NULL DEFAULT false;

-- 3. Invariant: tool_spare products MUST NOT have has_expiry = true. Enforced
--    at the DB layer in addition to the app-layer guard.
ALTER TABLE products
    ADD CONSTRAINT chk_tool_spare_no_expiry
    CHECK (product_class <> 'tool_spare' OR has_expiry = false);

-- 4. Partial index for the main new access pattern: listing products filtered
--    by class, scoped to the non-deleted subset (matches the existing product
--    list WHERE clause).
CREATE INDEX idx_products_class_active
    ON products (product_class)
    WHERE deleted_at IS NULL;
