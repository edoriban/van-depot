-- Multi-Tenant Foundation — Migration A1
-- Creates the `tenants` root table.
-- See: sdd/multi-tenant-foundation/design §3.1 and §3.4.

CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,

    -- Slug shape: 3-64 chars, lowercase alphanumeric + hyphens, must start/end with alnum.
    CONSTRAINT tenants_slug_format_chk
        CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),

    -- Reserved-word block: prevent collisions with system / API namespaces.
    CONSTRAINT tenants_slug_reserved_chk
        CHECK (slug NOT IN (
            'admin', 'api', 'www', 'app', 'public',
            'system', 'default', 'health', 'auth'
        )),

    -- Status guard: only the values used by the app.
    CONSTRAINT tenants_status_chk
        CHECK (status IN ('active', 'suspended'))
);

-- Active-tenant lookup index (excludes soft-deleted rows).
CREATE INDEX idx_tenants_status_active ON tenants (status) WHERE deleted_at IS NULL;

-- Reuse the existing `update_updated_at()` function created in
-- 20260404000001_initial_schema.sql. No new function required.
CREATE TRIGGER tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
