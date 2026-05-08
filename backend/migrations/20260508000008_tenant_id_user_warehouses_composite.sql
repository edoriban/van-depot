-- Multi-Tenant Foundation — Phase B Batch 8.1
-- Adds `tenant_id` to `user_warehouses` (the user↔warehouse many-to-many
-- junction) and turns its FKs into composite (tenant_id, *) tuples.
--
-- B8.1 inherits the JUNCTION-TABLE composite-FK pattern from B3
-- (supplier_products), B5 (recipe_items), B6 (purchase_order_lines), and B7
-- (cycle_count_items). What's NEW about B8.1 is that one of the composite-FK
-- targets is NOT a tenant-scoped DOMAIN row — it's `user_tenants(tenant_id,
-- user_id)`, the membership junction. This enforces at the DB level that a
-- user can only be assigned to a warehouse in tenant T if they are also a
-- member of T.
--
-- Schema before B8.1:
--   user_warehouses(user_id, warehouse_id)
--     PK (user_id, warehouse_id)
--     user_id     -> users(id)            ON DELETE CASCADE     [stays single-col]
--     warehouse_id -> warehouses(id)      ON DELETE CASCADE     [becomes composite]
--
-- Schema after B8.1:
--   user_warehouses(tenant_id, user_id, warehouse_id)
--     PK (tenant_id, user_id, warehouse_id)
--     tenant_id   -> tenants(id)                                ON DELETE RESTRICT
--     user_id     -> users(id)                                  ON DELETE CASCADE [stays]
--     (tenant_id, warehouse_id) -> warehouses(tenant_id, id)    ON DELETE CASCADE
--     (tenant_id, user_id)      -> user_tenants(tenant_id, user_id)  -- membership guard
--
-- The composite FK to `user_tenants` is the ACCEPTANCE CHECK for the spec
-- scenario "Cannot assign cross-tenant warehouse". `user_tenants(tenant_id,
-- user_id)` has a UNIQUE constraint installed by A2 (migration
-- 20260507000002 line 32) so the FK target is valid.
--
-- Operation order (CRITICAL — see task spec):
--   1. Add tenant_id nullable.
--   2. Backfill from the parent warehouse (every row references one
--      warehouse NOT NULL).
--   3. SET NOT NULL.
--   4. FK to tenants RESTRICT.
--   5. ADD the new composite FKs FIRST (with the existing PK still in
--      place — nothing in the schema enforces single-row uniqueness on
--      tenant_id alone, so this is safe).
--   6. DROP the old single-column FK on warehouse_id.
--   7. DROP the old PK (user_id, warehouse_id).
--   8. ADD the new PK (tenant_id, user_id, warehouse_id).
--   9. Indexes for the common query patterns.

-- ─── user_warehouses ─────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE user_warehouses ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent warehouse (warehouse_id is NOT NULL and
--    warehouses.tenant_id is NOT NULL post-B1).
UPDATE user_warehouses uw
   SET tenant_id = w.tenant_id
  FROM warehouses w
 WHERE uw.warehouse_id = w.id;

-- 3) Lock it down.
ALTER TABLE user_warehouses ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT (deleting a tenant with assignments must be
--    explicit; cascading would silently revoke everyone's access).
ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Composite FK to warehouses — replaces the original single-column FK
--    `user_warehouses_warehouse_id_fkey` which had ON DELETE CASCADE.
--    Add-before-drop. Junction-table convention — kill the warehouse, kill
--    the assignments — preserved.
ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_warehouse_tenant_fk
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES warehouses(tenant_id, id)
    ON DELETE CASCADE;

-- 6) Composite FK to user_tenants — the membership guard. A user can only
--    be assigned to a warehouse in tenant T if `user_tenants(T, user_id)`
--    exists. ON DELETE NO ACTION (default): revoking a membership is a
--    deliberate operation and should not silently nuke warehouse
--    assignments — the membership-revoke path explicitly clears them.
--
--    user_tenants has the UNIQUE constraint `user_tenants_tenant_user_key
--    UNIQUE (tenant_id, user_id)` installed by A2.
ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_user_tenant_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES user_tenants(tenant_id, user_id);

-- 7) Drop the original single-column FK on warehouse_id (replaced by the
--    composite FK above).
ALTER TABLE user_warehouses
    DROP CONSTRAINT user_warehouses_warehouse_id_fkey;

-- 8) `user_id` keeps its single-column FK to global users — A user's
--    deletion still cascades to clean up their assignments. The composite
--    FK to user_tenants is the membership predicate; the single-column
--    FK to users is the existence predicate. Both are needed.

-- 9) Replace PK (user_id, warehouse_id) with (tenant_id, user_id,
--    warehouse_id). The new PK is the canonical identity for an
--    assignment in the multi-tenant world.
ALTER TABLE user_warehouses DROP CONSTRAINT user_warehouses_pkey;

ALTER TABLE user_warehouses
    ADD CONSTRAINT user_warehouses_pkey PRIMARY KEY (tenant_id, user_id, warehouse_id);

-- 10) Indexes for the two common access patterns.
--
--   * `(user_id)` — list warehouses for a user (used by
--     get_user_warehouse_ids and list_user_warehouses).
--   * `(tenant_id, warehouse_id)` — list users for a warehouse (used by
--     list_by_warehouses joins).
--
-- The PK already provides a leftmost-prefix index on (tenant_id, user_id)
-- so we only need the two extras.
CREATE INDEX idx_user_warehouses_user ON user_warehouses (user_id);
CREATE INDEX idx_user_warehouses_tenant_warehouse ON user_warehouses (tenant_id, warehouse_id);
