# Migrations

This document captures the migration tooling, conventions, and dev workflow
for the VanDepot backend. It is intended for contributors who add or revert
schema changes.

## Tooling

Migrations are stored in `backend/migrations/` and applied at API boot via the
`sqlx::migrate!` macro:

```rust
// backend/crates/infra/src/db/pool.rs
sqlx::migrate!("../../migrations").run(&pool).await?;
```

There is **no** standalone CLI binary (e.g. `sqlx migrate run`) wired into the
project; the macro discovers files relative to the `infra` crate at compile
time and runs them transactionally on every startup. Migrations that have
already been applied (recorded in `_sqlx_migrations`) are skipped.

## File naming convention

Migrations follow the SQLx default:

```
backend/migrations/<timestamp>_<short_description>.sql
backend/migrations/<timestamp>_<short_description>.down.sql   # optional
```

- `<timestamp>` is `YYYYMMDDHHMMSS` (UTC, no separators).
- `<short_description>` is `snake_case`, ideally under ~40 chars.
- `.down.sql` companions are kept **for documentation and manual revert
  only** — they are NOT auto-applied. SQLx's `migrate!` macro is one-way.
  Downward revert is performed by hand against the dev DB (`psql -f ...`)
  followed by deleting the corresponding row from `_sqlx_migrations`.

## Multi-tenant migration order

The multi-tenant foundation (`sdd/multi-tenant-foundation`) sequences
migrations across phases. Order is **load-bearing** — Phase B's `tenant_id`
columns require Phase A's `tenants` table, and Phase C's RLS policies require
all `tenant_id` columns to exist and be `NOT NULL`.

| Phase | Migrations |
|-------|-----------|
| **A — Foundations** | `20260507000001_create_tenants.sql`, `20260507000002_user_tenants_and_superadmin.sql`, `20260507000003_drop_global_role.sql` |
| **B — `tenant_id` sweep** (8 batches) | `20260508000001..20260508000008_*.sql` (one per domain batch) |
| **B — stock_configuration per tenant** | `20260508000009_stock_configuration_per_tenant.sql` |
| **B — `tool_instances` tenant_id** | `20260508000010_tenant_id_tool_instances.sql` |
| **C — RLS lockdown** (atomic) | `20260509000001_rls_policies_phase_c.sql` |
| **C — runtime app role** | `20260509000002_create_app_role.sql` |
| **C — audit_log** | `20260509000003_audit_log.sql` |

Phases A, B, and C are landed and applied to the dev DB. After Phase C, the
runtime API connects as the non-superuser role `vandepot_app` (provisioned
by `20260509000002_create_app_role.sql`) so that `FORCE ROW LEVEL SECURITY`
actually binds. The boot sequence in `crates/api/src/main.rs` requires both
`DATABASE_URL` (superuser, migrations only) and `DATABASE_URL_APP`
(non-superuser, runtime).

Anyone adding new tenant-scoped tables must also:

1. Add `tenant_id UUID NOT NULL REFERENCES tenants(id)` plus an index
   leading with `tenant_id`.
2. `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
3. Add a `<table>_tenant_isolation` policy with `USING` + `WITH CHECK`
   matching the template in `20260509000001_rls_policies_phase_c.sql`.
4. `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO vandepot_app` —
   `ALTER DEFAULT PRIVILEGES` from `20260509000002` covers tables created by
   the migrations role going forward, but explicit grants document the
   access surface for the next reader.

Anyone touching existing tenant-scoped tables in a later migration must
prepend `SELECT set_config('app.is_superadmin', 'true', true);` so the
migration runner is allowed to see / update rows across tenants. See
`docs/multi-tenant.md` §5 and design §4.3 for the full discussion.

## Dev reset workflow

The project uses a **drop-and-reseed** strategy in dev (locked by the
multi-tenant foundation proposal — there are no paying customers yet, demo
data is regeneratable, so a backfill script for Phase B was deemed not worth
the engineering cost).

```bash
make reset-db
```

What `make reset-db` does:

1. Prints a destructive-action warning and waits 3s for `Ctrl-C`.
2. `docker compose down -v` — drops the `vandepot-postgres_data` volume.
3. `docker compose up -d postgres redis` — brings services back up.
4. Waits for `pg_isready` to succeed.
5. Boots `cargo run --bin vandepot-api` once with `RUN_SEED_SUPERADMIN=true` and
   `RUN_SEED_DEFAULT_TENANT=true`. The boot path runs migrations, upserts
   the superadmin, and upserts the default tenant (`slug='dev'`).
6. Kills the API once `/health` reports ready (or after a 60s grace).

After reset, only `tenants` (1 row) and `users` (1 row) are populated. All
tenant-scoped tables are empty. Demo data is per-tenant via
`POST /admin/tenants/{id}/seed-demo` (Phase D).

### Why slug `dev` for the default tenant

The user-locked decision called for slug `default`, but migration A1
codifies a reserved-slug CHECK that rejects `default`. The reserved list
exists to prevent collisions with future system namespaces. Since the
migration is already applied, the dev seed uses `dev` instead. If we ever
need to remove `default` from the reserved list, a follow-up migration
(`ALTER TABLE tenants DROP CONSTRAINT tenants_slug_reserved_chk` + recreate
without the entry) is the path — out of scope for A20.

## Adding a new migration

1. Create the file: `backend/migrations/YYYYMMDDHHMMSS_short_description.sql`
   using the current UTC timestamp.
2. Optionally add a `.down.sql` companion documenting how to revert (for
   manual rollback only — never auto-applied).
3. Author the SQL. Prefer `IF NOT EXISTS` / `IF EXISTS` guards so the
   migration is rerunnable against partially-migrated dev DBs.
4. Run `make reset-db` (or boot the API once with `RUN_SEED_SUPERADMIN=true`
   already set) to apply against the dev DB.
5. Verify in `psql`: `SELECT * FROM _sqlx_migrations ORDER BY version DESC
   LIMIT 5;` should show your file's version.
6. If the migration touches existing data and Phase C RLS is in effect, set
   `app.is_superadmin = 'true'` at the top of the migration so the runner can
   read/update across tenants:

   ```sql
   SELECT set_config('app.is_superadmin', 'true', true);
   -- now do your DDL / DML
   ```

   See design §4.3 for the full discussion.

## Rollback policy

- **Dev**: `make reset-db` (drop volume, rerun migrations from zero).
- **Staging / prod (future)**: forward-fix only. `.down.sql` files are
  kept as a paper trail for the on-call DBA — they are NOT a recovery
  path. If a migration causes incident-level breakage, restore from the
  most recent base backup + WAL replay.
