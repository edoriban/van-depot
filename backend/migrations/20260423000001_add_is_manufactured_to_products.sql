-- Work Orders & BOM — Migration 1/5.
-- Additive boolean marking a product as a manufacturable finished good.
-- Orthogonal to product_class: an FG keeps `product_class='raw_material'` and
-- sets `is_manufactured=true`. Cross-field invariant enforced via CHECK.
-- (Design §D3.)
ALTER TABLE products
    ADD COLUMN is_manufactured BOOLEAN NOT NULL DEFAULT false;

-- A product may only be marked manufactured if it is a raw_material.
-- Mirrors the `chk_tool_spare_no_expiry` precedent from 20260421000002.
ALTER TABLE products
    ADD CONSTRAINT products_manufactured_requires_raw_material
    CHECK (is_manufactured = false OR product_class = 'raw_material');

-- Partial index for the "?is_manufactured=true" product-list filter.
CREATE INDEX idx_products_manufactured
    ON products (is_manufactured)
    WHERE is_manufactured = true AND deleted_at IS NULL;
