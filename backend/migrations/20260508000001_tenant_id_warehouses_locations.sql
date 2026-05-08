-- Multi-Tenant Foundation — Phase B Batch 1
-- Adds `tenant_id` to `warehouses` and `locations`, scopes name-uniqueness to
-- the tenant, and installs a composite FK on locations so a row can NEVER
-- reference a warehouse in a different tenant.
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite FK
-- pattern that B8 will reuse for `user_warehouses`). Drop-and-reseed dev DB
-- approved (no customer data) — the backfill resolves leftover dev rows to
-- the canonical `dev` tenant introduced by A20's seed.
--
-- This migration is the TEMPLATE for B2..B7. Future batches replicate the
-- same operation order (add nullable column → backfill → NOT NULL → FK →
-- index → tenant-scoped uniqueness) per design §3.2.

-- ─── warehouses ──────────────────────────────────────────────────────────

-- 1) Nullable column so we can backfill existing rows (dev DB only).
ALTER TABLE warehouses ADD COLUMN tenant_id UUID;

-- 2) Backfill: assign every leftover row to the canonical dev tenant.
--    A20's seed installs `slug='dev'` exactly once (idempotent upsert).
--    If `dev` is missing the SET evaluates to NULL and step (3) fails, which
--    is the correct loud failure: the operator must run `make reset-db` (or
--    re-run the seed) before applying this migration.
UPDATE warehouses
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE warehouses ALTER COLUMN tenant_id SET NOT NULL;

-- 4) Defense-in-depth FK with RESTRICT (deleting a tenant with warehouses
--    must be EXPLICIT — a CASCADE here would silently nuke catalogs).
ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_warehouses_tenant ON warehouses(tenant_id);

-- 6) Tenant-scoped name uniqueness — different tenants may share a name,
--    same tenant may not. Original schema had no UNIQUE on name (only the
--    PK on id), so there is nothing to drop first.
--    NULLS NOT DISTINCT keeps soft-deleted rows from blocking re-creation
--    after a soft-delete + new tenant attempt — but warehouses use a hard
--    `deleted_at IS NULL` predicate everywhere, so we use a partial index
--    instead of NULLS NOT DISTINCT for compatibility with PG ≤14.
CREATE UNIQUE INDEX warehouses_tenant_name_key
    ON warehouses (tenant_id, name)
    WHERE deleted_at IS NULL;

-- 7) Composite uniqueness on (tenant_id, id). The PK on id is already unique,
--    so this index is redundant for the row itself — but it's REQUIRED as the
--    target of a future composite FK (the same pattern B8 will use for
--    `user_warehouses`). Adding it here proactively means `locations` can
--    install its composite FK in this same migration.
ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_tenant_id_id_key UNIQUE (tenant_id, id);

-- ─── locations ───────────────────────────────────────────────────────────

-- 1) Nullable column.
ALTER TABLE locations ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent warehouse — every existing location inherits
--    its tenant from its warehouse. Step (3) below would fail loudly if any
--    location existed without a warehouse (it can't — FK on warehouse_id),
--    so we don't need a fallback here.
UPDATE locations l
   SET tenant_id = w.tenant_id
  FROM warehouses w
 WHERE l.warehouse_id = w.id;

-- 3) Lock it down.
ALTER TABLE locations ALTER COLUMN tenant_id SET NOT NULL;

-- 4) Tenant FK (RESTRICT — same reasoning as warehouses).
ALTER TABLE locations
    ADD CONSTRAINT locations_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_locations_tenant ON locations(tenant_id);

-- 6) Composite FK to warehouses (tenant_id, id). This is the cross-tenant
--    integrity check: a location row's tenant_id MUST equal its parent
--    warehouse's tenant_id. The DB rejects any INSERT/UPDATE that violates
--    this, even if the application predicate is wrong.
--
--    Operation order: add the new composite FK BEFORE dropping the old
--    single-column FK so there is never a window where `warehouse_id` is
--    unenforced. Then drop the old FK once the composite is in place.
ALTER TABLE locations
    ADD CONSTRAINT locations_warehouse_tenant_fk
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES warehouses(tenant_id, id)
    ON DELETE CASCADE;

-- The original FK on warehouse_id was named by Postgres
-- (`locations_warehouse_id_fkey` per default convention). Drop it now that
-- the composite supersedes it. ON DELETE CASCADE preserved.
ALTER TABLE locations
    DROP CONSTRAINT locations_warehouse_id_fkey;
