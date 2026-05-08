-- Phase C polish (multi-tenant-foundation): create the runtime API role.
--
-- Background: in Phase C we enabled RLS + FORCE on every tenant-scoped table.
-- However, PostgreSQL superusers BYPASS row-level security regardless of the
-- `FORCE ROW LEVEL SECURITY` flag. The dev DB connection role `vandepot` is
-- a superuser so the killer SQL test (open psql, plant a bogus tenant in
-- session vars, SELECT) returned ALL rows — RLS appeared to "not fire".
--
-- Fix: split the connection role per-pool.
--   * `vandepot` (superuser, pre-existing)  — used ONLY for migrations + seed
--     during boot (control-plane, must be able to create roles, alter schema,
--     etc.). After seeds finish, the migrations pool is dropped.
--   * `vandepot_app` (LOGIN, NOT superuser) — used by the runtime app pool the
--     API serves traffic from. Because this role is non-superuser, `FORCE ROW
--     LEVEL SECURITY` actually binds it: every SELECT/INSERT/UPDATE/DELETE on
--     a tenant-scoped table is gated by the policy
--     `(is_superadmin='true') OR (tenant_id = current_setting('app.current_tenant', true)::uuid)`.
--
-- See `crates/api/src/main.rs` for the boot sequence that uses both pools.
-- See `crates/api/src/middleware/tenant_tx.rs` for the per-request tx that
-- plants `app.current_tenant` and `app.is_superadmin` via `set_config(...)`.
--
-- Idempotent: re-running this migration after a `make reset-db` does not fail
-- (CREATE ROLE is guarded by a DO block; GRANTs are unconditional and harmless
-- when re-applied).

-- 1. Create the role if it doesn't exist. Password is hardcoded for dev; in
--    prod the role + password come from secrets manager (see docs).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vandepot_app') THEN
        CREATE ROLE vandepot_app WITH LOGIN PASSWORD 'vandepot_app';
    END IF;
END
$$;

-- 2. Allow this role to connect to the database.
GRANT CONNECT ON DATABASE vandepot TO vandepot_app;

-- 3. Schema usage. Without this, even with table-level GRANTs, the role can't
--    resolve unqualified names.
GRANT USAGE ON SCHEMA public TO vandepot_app;

-- 4. Existing tables: full DML on every table that exists today. Bulk grant
--    is intentional — RLS, not GRANTs, is the per-row gate. The role's
--    privilege boundary is "any row in any tenant-scoped table is reachable
--    IF the RLS policy allows it for the current session vars."
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vandepot_app;

-- 5. Existing sequences. Required for `DEFAULT nextval('...')` on inserts.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vandepot_app;

-- 6. Default privileges so future migrations' new tables/sequences are
--    accessible to vandepot_app without manual GRANTs after every migration.
--    Applies to objects created BY THE SUPERUSER `vandepot` (the role that
--    runs migrations).
ALTER DEFAULT PRIVILEGES FOR ROLE vandepot IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vandepot_app;

ALTER DEFAULT PRIVILEGES FOR ROLE vandepot IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vandepot_app;

-- 7. Existing enum types. Postgres enum types use `USAGE` to allow casts
--    (e.g. `'pending'::tenant_role`). Without this, INSERTs that bind a
--    string to an enum column fail with "permission denied for type".
GRANT USAGE ON TYPE tenant_role TO vandepot_app;

-- Other enum types in the schema (added defensively; safe to re-run).
DO $$
DECLARE
    enum_name text;
BEGIN
    FOR enum_name IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e'
          AND n.nspname = 'public'
    LOOP
        EXECUTE format('GRANT USAGE ON TYPE public.%I TO vandepot_app', enum_name);
    END LOOP;
END
$$;

-- 8. Sanity: confirm vandepot_app is NOT a superuser. If a previous run
--    accidentally promoted it (e.g. via CREATE ROLE ... SUPERUSER), this
--    migration explicitly downgrades. Without this, RLS would silently
--    bypass and the killer SQL test would return rows it shouldn't.
ALTER ROLE vandepot_app NOSUPERUSER NOBYPASSRLS;
