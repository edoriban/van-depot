-- Down for 20260508000002_tenant_id_products_categories.sql
-- Reverses every operation in REVERSE order. Order matters: the composite
-- FKs (products → categories, categories → categories self-ref) must be
-- dropped BEFORE the categories `(tenant_id, id) UNIQUE` they target.

-- ─── products: restore single-column category FK + global sku UNIQUE ────

-- Re-add the original idx_products_sku (partial, redundant with the now-
-- removed unique index but matches pre-B2 schema).
CREATE INDEX idx_products_sku ON products(sku) WHERE deleted_at IS NULL;

-- Drop the tenant-scoped UNIQUE.
DROP INDEX IF EXISTS products_tenant_sku_key;

-- Restore the global UNIQUE on sku (matches initial_schema line 88).
ALTER TABLE products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);

-- Restore single-column category FK BEFORE dropping the composite, so
-- category_id is continuously enforced.
ALTER TABLE products
    ADD CONSTRAINT products_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_tenant_fk;

DROP INDEX IF EXISTS idx_products_tenant;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tenant_fk;
ALTER TABLE products DROP COLUMN IF EXISTS tenant_id;

-- ─── categories: restore self-ref FK, drop composites + tenant column ───

-- Restore single-column self-ref FK BEFORE dropping the composite.
ALTER TABLE categories
    ADD CONSTRAINT categories_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_parent_tenant_fk;

-- Drop the tenant-scoped name UNIQUE.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_tenant_parent_name_key;

-- Drop the composite UNIQUE last — products' composite FK (already
-- dropped above) and categories' self-ref FK (just dropped) both depended
-- on it.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_tenant_id_id_key;

DROP INDEX IF EXISTS idx_categories_tenant;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_tenant_fk;
ALTER TABLE categories DROP COLUMN IF EXISTS tenant_id;
