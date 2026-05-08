-- Phase C task C7 (multi-tenant-foundation): control-plane audit log.
--
-- Captures superadmin-initiated mutations of the tenant control plane plus
-- every impersonation token mint. Append-only, queryable by superadmin only.
--
-- Why control plane (no RLS):
--   This table is written by superadmin-only paths (`/admin/*`) and is
--   intentionally OUTSIDE the per-tenant isolation boundary. Putting RLS on
--   it would either (a) require yet another bypass flag, or (b) risk hiding
--   audit rows from the very actor who needs to read them. Following the
--   precedent of `tenants` / `users` / `user_tenants` (also exempt — see
--   migration 20260509000001_rls_policies_phase_c.sql), we leave RLS off.
--   Access control is enforced at the API layer by the superadmin_guard
--   middleware on `/admin/*`.

CREATE TABLE audit_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- `actor_user_id` is NOT NULL because every audit row HAS an actor by
    -- definition. We use ON DELETE RESTRICT (the default) so deleting a user
    -- with audit history fails loud instead of silently nulling history. If
    -- a future operation needs to hard-delete a user, a separate retention
    -- pass should run on `audit_log` first.
    actor_user_id     UUID NOT NULL REFERENCES users(id),
    event             TEXT NOT NULL,
    -- target_tenant_id / target_user_id are nullable because some events
    -- (e.g. impersonation by a superadmin) target a tenant only; user-level
    -- events target a user only. SET NULL on the FK because audit history
    -- should survive even if the target row is deleted.
    target_tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL,
    target_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata          JSONB,
    issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    source_ip         INET
);

COMMENT ON TABLE audit_log IS
    'Append-only superadmin audit trail. Control-plane table, intentionally NOT subject to RLS. See migration 20260509000003_audit_log.sql for rationale.';

-- Hot path: "show me everything actor X did, newest first".
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id, issued_at DESC);

-- Hot path: "show me everything done to tenant Y, newest first".
CREATE INDEX idx_audit_log_target_tenant ON audit_log (target_tenant_id, issued_at DESC);

-- Filter by event type (e.g. "all impersonation mints last week").
CREATE INDEX idx_audit_log_event ON audit_log (event);

-- Re-grant the standard runtime privileges. The `vandepot_app` role exists
-- from migration 20260509000002 and is the runtime API connection role; it
-- needs DML on the audit table so `/admin/*` handlers (which run on the app
-- pool) can append rows. Existing GRANT ON ALL TABLES from that migration
-- only covers tables that existed at the time it ran — new tables need an
-- explicit grant. (`ALTER DEFAULT PRIVILEGES` from 20260509000002 covers
-- objects created BY `vandepot` going forward, but we make this explicit
-- here so an operator reading this migration sees the access surface.)
GRANT SELECT, INSERT ON audit_log TO vandepot_app;
-- Audit rows are append-only by contract; UPDATE/DELETE are intentionally
-- NOT granted. If a future task needs retention pruning, it should run as
-- the migrations role (`vandepot`), not the runtime app role.
