-- Multi-Tenant Foundation — Migration A2
-- Adds the `tenant_role` enum, the `user_tenants` membership junction, and
-- the `users.is_superadmin` bypass flag.
--
-- NOTE: this migration intentionally does NOT touch `users.role` or the
-- existing `user_role` enum — that lives in migration A3 (separate file).

-- 1) Per-tenant role enum.
CREATE TYPE tenant_role AS ENUM ('owner', 'manager', 'operator');

-- 2) Superadmin bypass flag on users.
ALTER TABLE users
    ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false;

-- 3) Membership junction.
CREATE TABLE user_tenants (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role        tenant_role NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ,
    PRIMARY KEY (user_id, tenant_id)
);

-- "list users in tenant" lookup.
CREATE INDEX idx_user_tenants_tenant ON user_tenants (tenant_id);

-- Composite UNIQUE on (tenant_id, user_id) so future composite FKs (B8) can
-- reference this column-set explicitly. The PRIMARY KEY is (user_id, tenant_id),
-- so this index is intentionally distinct in column order.
ALTER TABLE user_tenants
    ADD CONSTRAINT user_tenants_tenant_user_key UNIQUE (tenant_id, user_id);
