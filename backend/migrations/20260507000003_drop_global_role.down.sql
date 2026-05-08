-- Down migration for 20260507000003_drop_global_role.sql
--
-- Recreates the `user_role` enum (with the EXACT original variant list from
-- 20260404000001_initial_schema.sql) and re-adds the `users.role` column.
--
-- TRADE-OFF: the column is restored as NULLABLE, NOT with the original
-- `NOT NULL DEFAULT 'operator'` constraint. We cannot fabricate plausible
-- per-user role values on rollback — at the time of A3, every user is
-- represented either by `is_superadmin = true` (bypass) or by zero-or-more
-- rows in `user_tenants` (tenant-scoped roles). Restoring `NOT NULL` would
-- require choosing a default for every existing user, which would silently
-- fabricate authorization state. Operators rolling back are expected to
-- backfill `users.role` themselves before re-enabling any code that reads
-- the column.

CREATE TYPE user_role AS ENUM ('superadmin', 'owner', 'warehouse_manager', 'operator');

ALTER TABLE users ADD COLUMN role user_role;
