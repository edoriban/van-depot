-- Down for 20260508000003_tenant_id_suppliers_supplier_products.sql
-- Reverses every operation in REVERSE order. The composite FKs (both
-- supplier_products → suppliers and supplier_products → products) must
-- come down BEFORE we drop `(tenant_id, id) UNIQUE` from suppliers and
-- products. Restore single-column FKs before dropping composites so the
-- columns are continuously enforced.

-- ─── supplier_products: restore single-column FKs, drop composites ───────

-- Restore single-column FK to products (CASCADE matches supplier_management
-- line 8). Add it BEFORE dropping the composite so product_id is never
-- unenforced.
ALTER TABLE supplier_products
    ADD CONSTRAINT supplier_products_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE supplier_products DROP CONSTRAINT IF EXISTS supplier_products_product_tenant_fk;

-- Restore single-column FK to suppliers (CASCADE matches supplier_management
-- line 7).
ALTER TABLE supplier_products
    ADD CONSTRAINT supplier_products_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;

ALTER TABLE supplier_products DROP CONSTRAINT IF EXISTS supplier_products_supplier_tenant_fk;

DROP INDEX IF EXISTS idx_supplier_products_tenant;
ALTER TABLE supplier_products DROP CONSTRAINT IF EXISTS supplier_products_tenant_fk;
ALTER TABLE supplier_products DROP COLUMN IF EXISTS tenant_id;

-- ─── products: drop additive (tenant_id, id) UNIQUE ──────────────────────

-- This was added by B3 to be the FK target for supplier_products. Once
-- supplier_products' composite FKs are dropped (above), this constraint
-- is unreferenced and can be dropped cleanly.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tenant_id_id_key;

-- ─── suppliers: drop tenant-name unique, composite unique, FK, index, col

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tenant_name_key;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tenant_id_id_key;
DROP INDEX IF EXISTS idx_suppliers_tenant;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tenant_fk;
ALTER TABLE suppliers DROP COLUMN IF EXISTS tenant_id;
