-- A3: Drop the legacy global `users.role` column and the `user_role` enum.
--
-- The global per-user role is replaced by:
--   * `users.is_superadmin` (added in 20260507000002) — bypass identity.
--   * `user_tenants.role`   (tenant-scoped, type `tenant_role`).
--
-- This is the point-of-no-return for Phase A rollback: once this migration
-- is applied, every backend code path that read `users.role` is gone (see
-- task A3 for the audit). The down migration recreates the type and column
-- but cannot fabricate per-row values for existing rows — see the .down.sql
-- for the documented trade-off.

ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;
