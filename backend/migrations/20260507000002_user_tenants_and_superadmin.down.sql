-- Down migration for 20260507000002_user_tenants_and_superadmin.sql
-- Reverses, in opposite order: junction (with its unique index), users column,
-- and finally the enum (which can only drop after no column references it).

ALTER TABLE user_tenants DROP CONSTRAINT IF EXISTS user_tenants_tenant_user_key;
DROP INDEX IF EXISTS idx_user_tenants_tenant;
DROP TABLE IF EXISTS user_tenants;

ALTER TABLE users DROP COLUMN IF EXISTS is_superadmin;

DROP TYPE IF EXISTS tenant_role;
