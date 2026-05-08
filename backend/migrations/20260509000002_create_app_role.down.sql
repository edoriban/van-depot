-- Down migration for 20260509000002_create_app_role.sql.
--
-- Drops the runtime app role and its privileges. Note: `DROP ROLE` fails if
-- the role still owns objects or has active connections. For dev that's fine
-- — `make reset-db` drops the volume entirely. For prod rollbacks, the
-- operator is expected to disconnect clients and reassign ownership first.

-- 1. Revoke default privileges so dropping the role doesn't leave dangling
--    grants on future objects.
ALTER DEFAULT PRIVILEGES FOR ROLE vandepot IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM vandepot_app;

ALTER DEFAULT PRIVILEGES FOR ROLE vandepot IN SCHEMA public
    REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM vandepot_app;

-- 2. Revoke explicit privileges (table, sequence, schema).
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM vandepot_app;
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM vandepot_app;
REVOKE USAGE ON SCHEMA public FROM vandepot_app;
REVOKE CONNECT ON DATABASE vandepot FROM vandepot_app;

-- Enum types
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
        EXECUTE format('REVOKE USAGE ON TYPE public.%I FROM vandepot_app', enum_name);
    END LOOP;
END
$$;

-- 3. Drop the role. Idempotent.
DROP ROLE IF EXISTS vandepot_app;
