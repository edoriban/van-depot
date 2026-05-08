-- Multi-Tenant Foundation — Phase B Batch 2
-- Adds `tenant_id` to `categories` and `products`. Categories migrate FIRST
-- because products may FK to a category and we install the composite FK
-- `(tenant_id, category_id) → categories(tenant_id, id)` only after
-- categories carries `(tenant_id, id) UNIQUE`.
--
-- B2 introduces patterns NEW relative to B1 (warehouses+locations):
--   * Self-referential composite FK on `categories.parent_id` →
--     `categories(tenant_id, id)` — a child category MUST live in the same
--     tenant as its parent. The FK is its own integrity check.
--   * `categories` has NO `deleted_at` column, so the tenant-scoped
--     uniqueness is a plain UNIQUE (NULLS NOT DISTINCT) rather than a
--     `WHERE deleted_at IS NULL` partial index. Postgres ≥15 supports
--     `NULLS NOT DISTINCT`; our dev DB is on PG 17.
--   * `products(sku)` is a partial UNIQUE WHERE deleted_at IS NULL — soft-
--     deleted products free up the SKU for reuse within the same tenant.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite
-- FK pattern). The B1 template documents the operation order: nullable
-- column → backfill → NOT NULL → FK ON DELETE RESTRICT → idx_*_tenant →
-- (tenant-scoped uniqueness | composite FK).

-- ─── categories ──────────────────────────────────────────────────────────
-- (Order: categories must finish FIRST so products' composite FK has a
-- target to bind to.)

-- 1) Nullable tenant_id column.
ALTER TABLE categories ADD COLUMN tenant_id UUID;

-- 2) Backfill from the seeded `dev` tenant (drop-and-reseed approved per
--    Phase B charter — no customer data on dev DB).
UPDATE categories
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT (deleting a tenant with categories must be
--    explicit; cascading would silently nuke catalogs).
ALTER TABLE categories
    ADD CONSTRAINT categories_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_categories_tenant ON categories(tenant_id);

-- 6) Composite uniqueness target — `(tenant_id, id)` is required as the
--    parent side of:
--      * the self-referential composite FK on `categories.parent_id`, and
--      * the products' composite FK on `category_id`.
ALTER TABLE categories
    ADD CONSTRAINT categories_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Self-referential parent FK becomes tenant-bounded. Drop the original
--    single-column FK (default-named `categories_parent_id_fkey` per
--    initial_schema.sql line 76) and add the composite. Same ON DELETE
--    behavior as the original (SET NULL).
--
--    Add the composite BEFORE dropping the single-column FK so parent_id
--    is never unenforced during the migration.
ALTER TABLE categories
    ADD CONSTRAINT categories_parent_tenant_fk
    FOREIGN KEY (tenant_id, parent_id)
    REFERENCES categories(tenant_id, id)
    ON DELETE SET NULL;

ALTER TABLE categories
    DROP CONSTRAINT categories_parent_id_fkey;

-- 8) Tenant-scoped name uniqueness — no global `name` UNIQUE existed on
--    `categories` (initial_schema only had the PK). NULLS NOT DISTINCT
--    treats two NULL `parent_id`s as equal, so a tenant cannot have two
--    top-level categories with the same name. Postgres 17 supports this
--    syntax natively.
ALTER TABLE categories
    ADD CONSTRAINT categories_tenant_parent_name_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, parent_id, name);

-- ─── products ────────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE products ADD COLUMN tenant_id UUID;

-- 2) Backfill from the seeded `dev` tenant.
UPDATE products
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE products ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE products
    ADD CONSTRAINT products_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_products_tenant ON products(tenant_id);

-- 6) Composite FK on (tenant_id, category_id) → categories(tenant_id, id).
--    Same DB-layer integrity guarantee that B1 installed for
--    locations(tenant_id, warehouse_id): a product cannot reference a
--    category in another tenant. The original FK was named
--    `products_category_id_fkey` (default) with ON DELETE SET NULL. Match
--    the SET NULL behavior.
ALTER TABLE products
    ADD CONSTRAINT products_category_tenant_fk
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES categories(tenant_id, id)
    ON DELETE SET NULL;

ALTER TABLE products
    DROP CONSTRAINT products_category_id_fkey;

-- 7) Tenant-scoped SKU uniqueness — replace the global `products_sku_key`
--    UNIQUE that initial_schema installed (line 88: `sku VARCHAR(100) NOT
--    NULL UNIQUE`). The replacement is a partial UNIQUE so a soft-deleted
--    product's SKU can be reused within the same tenant.
--
--    Drop the original UNIQUE first (the new partial index supersedes it).
ALTER TABLE products DROP CONSTRAINT products_sku_key;

CREATE UNIQUE INDEX products_tenant_sku_key
    ON products (tenant_id, sku)
    WHERE deleted_at IS NULL;

-- The pre-existing `idx_products_sku` (initial_schema.sql line 153, partial
-- WHERE deleted_at IS NULL) is now redundant with the unique index above
-- (a unique index also serves as a non-unique lookup index). Drop it to
-- keep the schema tidy.
DROP INDEX idx_products_sku;
