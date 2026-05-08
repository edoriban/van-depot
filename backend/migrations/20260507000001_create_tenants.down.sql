-- Down migration for 20260507000001_create_tenants.sql
-- The shared `update_updated_at()` function pre-existed (initial schema), so
-- we MUST NOT drop it here — only the trigger and table belong to this migration.

DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
DROP INDEX IF EXISTS idx_tenants_status_active;
DROP TABLE IF EXISTS tenants;
