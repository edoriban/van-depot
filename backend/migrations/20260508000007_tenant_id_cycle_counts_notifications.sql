-- Multi-Tenant Foundation — Phase B Batch 7
-- Adds `tenant_id` to `cycle_counts`, `cycle_count_items`, and
-- `notifications`.
--
-- B7 inherits patterns from B1..B6:
--   * Junction-table composite FKs to BOTH parents (B3) — cycle_count_items
--     follows the supplier_products / recipe_items / work_order_materials
--     template (composite-FK to the parent header AND to products + locations).
--   * Pre-install `(tenant_id, id) UNIQUE` on parents in this migration
--     (B4 rule) — cycle_counts gains it because cycle_count_items
--     composite-FK back. Not needed on cycle_count_items (no composite-FK
--     pointing at it). Not needed on notifications (it's a leaf — no other
--     row composite-FKs to a notification).
--   * add-before-drop on every composite-FK swap (B1..B4 rule).
--   * `notifications.user_id` STAYS a single-column FK — users are
--     tenant-agnostic in our design (B4 §10 movements.user_id template).
--     The tenant_id column on `notifications` carries the isolation; in
--     Phase C, RLS scopes a multi-membership user to ONLY the active
--     tenant's notifications, even though the same user_id appears in
--     other tenants' rows.
--   * NULLABLE composite FK with MATCH SIMPLE (B4 rule) — none required
--     this batch. cycle_count_items.cycle_count_id, .product_id, and
--     .location_id are all NOT NULL.
--
-- Operation order (parents first → composite-FK targets first):
--   1. cycle_counts: add tenant_id (backfill from parent warehouse — the
--      cycle_count has warehouse_id NOT NULL and warehouses carries
--      tenant_id post-B1), tenant FK RESTRICT, idx, `(tenant_id, id) UNIQUE`
--      (target for cycle_count_items), composite FK to warehouses (NOT NULL).
--      `created_by` (user_id) STAYS single-column to global users.
--   2. cycle_count_items: add tenant_id (backfill from parent cycle_count),
--      tenant FK, idx, composite FK to cycle_counts (CASCADE preserved) +
--      composite FK to products + composite FK to locations.
--   3. notifications: add tenant_id (backfill from `dev` tenant — there
--      is no clean derivation path; reference_id is a free-form UUID and
--      reference_type is a string, so the parent table is unknown at the
--      row level. Drop-and-reseed approved per Phase B charter — no
--      customer data on dev DB. Same approach as B5 recipes.), tenant FK,
--      idx. `user_id` STAYS single-column (per the rationale above).
--      No composite uniqueness target (notifications has no children).
--      `dedup_key` UNIQUE was a partial UNIQUE (user_id, dedup_key) — the
--      dedup_key already includes the product_id which is tenant-scoped,
--      so cross-tenant collisions are practically impossible; we do NOT
--      change the dedup constraint in this batch (it's still tenant-correct
--      via the embedded product_id, and changing it would require a
--      coordinated dedup_key format change).
--
-- See: sdd/multi-tenant-foundation/design §3.2 (sweep) and §3.3 (composite
-- FK pattern). B7 collapses the last `fetch_warehouse_tenant_id`-style
-- inline shim from cycle_count_repo.

-- ─── cycle_counts ────────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE cycle_counts ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent warehouse. cycle_counts.warehouse_id is
--    NOT NULL and warehouses carries tenant_id post-B1.
UPDATE cycle_counts cc
   SET tenant_id = w.tenant_id
  FROM warehouses w
 WHERE cc.warehouse_id = w.id;

-- 3) Lock it down.
ALTER TABLE cycle_counts ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE cycle_counts
    ADD CONSTRAINT cycle_counts_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_cycle_counts_tenant ON cycle_counts(tenant_id);

-- 6) Composite uniqueness target — required because cycle_count_items
--    composite-FKs to cycle_counts(tenant_id, id) below.
ALTER TABLE cycle_counts
    ADD CONSTRAINT cycle_counts_tenant_id_id_key UNIQUE (tenant_id, id);

-- 7) Composite FK to warehouses (NOT NULL). Original FK was the
--    default-named `cycle_counts_warehouse_id_fkey` (no ON DELETE → NO
--    ACTION). Add-before-drop.
ALTER TABLE cycle_counts
    ADD CONSTRAINT cycle_counts_warehouse_tenant_fk
    FOREIGN KEY (tenant_id, warehouse_id)
    REFERENCES warehouses(tenant_id, id);

ALTER TABLE cycle_counts
    DROP CONSTRAINT cycle_counts_warehouse_id_fkey;

-- 8) `created_by` (user_id) STAYS a single-column FK to global users —
--    same rationale as movements.user_id (B4 §10).

-- ─── cycle_count_items ───────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE cycle_count_items ADD COLUMN tenant_id UUID;

-- 2) Backfill from the parent cycle_count (junction-style child: every row
--    references one cycle_count NOT NULL).
UPDATE cycle_count_items cci
   SET tenant_id = cc.tenant_id
  FROM cycle_counts cc
 WHERE cci.cycle_count_id = cc.id;

-- 3) Lock it down.
ALTER TABLE cycle_count_items ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup index.
CREATE INDEX idx_cycle_count_items_tenant ON cycle_count_items(tenant_id);

-- 6) Composite FK to cycle_counts — replaces the original
--    `cycle_count_items_cycle_count_id_fkey` with ON DELETE CASCADE
--    (junction-table convention, preserved). Add-before-drop.
ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_cc_tenant_fk
    FOREIGN KEY (tenant_id, cycle_count_id)
    REFERENCES cycle_counts(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE cycle_count_items
    DROP CONSTRAINT cycle_count_items_cycle_count_id_fkey;

-- 7) Composite FK to products — replaces the original
--    `cycle_count_items_product_id_fkey` (no explicit ON DELETE → NO
--    ACTION).
ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id);

ALTER TABLE cycle_count_items
    DROP CONSTRAINT cycle_count_items_product_id_fkey;

-- 8) Composite FK to locations — replaces the original
--    `cycle_count_items_location_id_fkey` (no explicit ON DELETE → NO
--    ACTION). locations(tenant_id, id) UNIQUE was installed in B4.
ALTER TABLE cycle_count_items
    ADD CONSTRAINT cycle_count_items_location_tenant_fk
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES locations(tenant_id, id);

ALTER TABLE cycle_count_items
    DROP CONSTRAINT cycle_count_items_location_id_fkey;

-- 9) `counted_by` (user_id) STAYS a single-column FK to global users.
--    Same rationale as cycle_counts.created_by above.

-- 10) The original `UNIQUE(cycle_count_id, product_id, location_id)` is
--     preserved — all three refs share tenant_id via the composite FKs
--     above, so the constraint is tenant-correct without modification.

-- ─── notifications ───────────────────────────────────────────────────────

-- 1) Nullable tenant_id column.
ALTER TABLE notifications ADD COLUMN tenant_id UUID;

-- 2) Backfill from the seeded `dev` tenant. There is no clean
--    parent-row derivation: `reference_id` is a free-form UUID and
--    `reference_type` is a string (currently 'product' for stock alerts),
--    so we cannot statically derive tenant_id at migration time without
--    per-reference_type joins. The dev DB has no customer data, so the
--    dev-tenant default is fine. Drop-and-reseed approved per Phase B
--    charter.
UPDATE notifications
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'dev');

-- 3) Lock it down.
ALTER TABLE notifications ALTER COLUMN tenant_id SET NOT NULL;

-- 4) FK to tenants — RESTRICT.
ALTER TABLE notifications
    ADD CONSTRAINT notifications_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5) Tenant-scoped lookup indexes. Mirror the existing per-user indexes
--    so list endpoints scoped to (user_id, tenant_id, ...) stay efficient.
CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX idx_notifications_user_tenant_created ON notifications (user_id, tenant_id, created_at DESC);

-- 6) `user_id` STAYS a single-column FK to global users — users are
--    tenant-agnostic. A multi-tenant user's notifications are scoped to
--    the active tenant via the new `tenant_id` column (Phase C will add
--    RLS that enforces this at the DB layer; until then handlers add
--    `WHERE tenant_id = $tenant_id` alongside the existing
--    `WHERE user_id = $user_id`).

-- 7) The existing `idx_notifications_dedup` partial UNIQUE on
--    (user_id, dedup_key) is preserved as-is. The dedup_key currently
--    embeds product_id (which is tenant-scoped post-B2), so cross-tenant
--    collisions are practically impossible. A future migration can
--    promote it to (user_id, tenant_id, dedup_key) once the dedup_key
--    format is standardized; for B7 that's out of scope.
