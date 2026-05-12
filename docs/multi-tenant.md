# Multi-tenant Architecture

VanDepot serves multiple tenants from a shared backend instance. Tenants are
isolated at the schema level (`tenant_id` column on every domain table), at
the database level (PostgreSQL Row-Level Security plus a non-superuser runtime
role), and at the application layer (every repository query carries an
explicit `WHERE tenant_id = $N` predicate). Authentication is JWT-based and
the active `tenant_id` is carried in the access token.

This document is the operator and contributor reference. The driving SDD
artifacts live under `sdd/multi-tenant-foundation/*` (proposal / spec /
design / tasks). Anything here is a summary; the SDD spec is authoritative
on requirements.

## 1. Request lifecycle

```
HTTP request
  └─► auth middleware (Claims extractor — decodes the JWT)
      └─► tenant_tx middleware
          ├── pool.begin()                            // per-request tx
          ├── set_config('app.current_tenant', $1, true)
          ├── set_config('app.is_superadmin',  $1, true)
          ├── verify_membership(user_id, tenant_id)   // 403 if revoked
          └─► handler(Tenant(mut tt))
              └── repo functions take (&mut *tt.tx, tenant_id, ...)
              └── tt.commit().await? on the Ok path
              ◄── drop(tt) on the Err path = automatic ROLLBACK
```

The `is_local = true` third argument to `set_config` makes both session
variables transaction-scoped. They auto-clear on COMMIT/ROLLBACK, which
prevents tenant context from leaking across pool checkouts.

## 2. Tenant lifecycle

- **Creation**: `POST /admin/tenants` (superadmin only). The handler also
  replicates the canonical `stock_configuration` defaults under the new
  tenant via `seed::stock_config::replicate_stock_config_for_tenant` so every
  tenant boots with a uniform configuration baseline.
- **Soft-delete**: `DELETE /admin/tenants/{id}` flips `status` to
  `'suspended'` and stamps `deleted_at`. The row is preserved for audit; data
  in dependent tables stays intact.
- **Suspension semantics**: `verify_membership` filters tenants on
  `status = 'active' AND deleted_at IS NULL`. Suspended tenants therefore
  block login, `/auth/select-tenant`, `/auth/refresh`, and any further
  authenticated request from their members.

## 3. Authentication flow (two-step login)

`POST /auth/login` is the entry point. The handler branches on the user
record:

| Branch | Response |
|---|---|
| `is_superadmin = true` | Final access + refresh token pair (`tenant_id = null`, `is_superadmin = true`). |
| 0 active memberships, not superadmin | `403 Forbidden` (`no_active_memberships`). |
| Exactly 1 active membership | Final access + refresh tokens scoped to that tenant + role. |
| 2 or more active memberships | `Intermediate` token (60 s TTL) plus a `memberships[]` array (each entry: `tenant_id`, `slug`, `name`, `role`). |

`POST /auth/select-tenant` (multi-membership users): body `{ tenant_id }`,
`Authorization: Bearer <intermediate>`. Re-verifies the membership is still
active, then mints the final token pair.

`POST /auth/refresh`: re-verifies membership for non-superadmins, so role
changes and tenant suspensions take effect without forcing logout.

## 4. Roles and permissions

`tenant_role` is a Postgres `ENUM('owner', 'manager', 'operator')`:

| Role | Capabilities |
|---|---|
| `owner` | Full CRUD on every tenant-scoped resource; manages users / memberships within the tenant. |
| `manager` | Full CRUD on every tenant-scoped resource; reads users only. |
| `operator` | Reads catalogs; creates entry/exit movements and work orders; executes cycle counts. |

A user can hold **different roles in different tenants** through the
`user_tenants(user_id, tenant_id, role)` junction table.

**Superadmin** is global: `users.is_superadmin = true` AND zero rows in
`user_tenants`. Superadmins bypass RLS via `app.is_superadmin = 'true'` but
are NOT members of any tenant — they operate via `/admin/*` routes or the
impersonation flow (§9 below).

## 5. Database isolation contract

### 5.1 Tenant-scoped tables (24 — RLS enabled with FORCE)

`warehouses`, `locations`, `products`, `categories`, `suppliers`,
`supplier_products`, `inventory`, `product_lots`, `inventory_lots`,
`movements`, `recipes`, `recipe_items`, `work_orders`,
`work_order_materials`, `purchase_orders`, `purchase_order_lines`,
`purchase_returns`, `purchase_return_items`, `cycle_counts`,
`cycle_count_items`, `notifications`, `user_warehouses`,
`stock_configuration`, `tool_instances`.

Each carries `tenant_id UUID NOT NULL REFERENCES tenants(id)` plus an index
leading with `tenant_id`. Composite uniqueness (e.g. `(tenant_id, sku)` on
products) replaces previous global unique constraints. Composite foreign
keys (e.g. `user_warehouses (tenant_id, warehouse_id) → warehouses(tenant_id, id)`)
prevent cross-tenant references at the DB layer.

### 5.2 Control-plane tables (no RLS)

`tenants`, `users`, `user_tenants`, `audit_log`. These are written by
superadmin-only paths and queried by the middleware before any tenant
context exists. RLS would either require yet another bypass flag or risk
hiding rows from the only actor allowed to read them.

### 5.3 RLS policy template

Every tenant-scoped table receives the same `<table>_tenant_isolation`
policy:

```sql
USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
)
WITH CHECK (
    current_setting('app.is_superadmin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
)
```

`USING` filters reads (and existence checks for UPDATE/DELETE);
`WITH CHECK` blocks INSERT/UPDATE that would land a row in another tenant.
The second argument `true` to `current_setting` returns `NULL` when the
setting is missing instead of erroring — so a request that bypasses the
middleware (somehow) sees zero rows by default.

### 5.4 Defense in depth

Every repository query also includes an explicit `WHERE tenant_id = $N`.
RLS is the second wall, not the first. This keeps repo code self-documenting
and surfaces mistakes during review even before the DB rejects them.

## 6. Role split (production-critical)

Two PostgreSQL roles, two pools, two URLs.

| Role | Purpose | Connection URL |
|---|---|---|
| `vandepot` (superuser) | Runs migrations, bootstraps superadmin, seeds the dev default tenant. Used **only** at boot. | `DATABASE_URL` |
| `vandepot_app` (LOGIN, NOT superuser, NOBYPASSRLS) | Serves every authenticated request at runtime. RLS binds it. | `DATABASE_URL_APP` |

Postgres superusers bypass RLS regardless of `FORCE ROW LEVEL SECURITY`. If
the runtime role were a superuser, RLS would silently no-op. The boot
sequence in `crates/api/src/main.rs` opens the migrations pool, runs
migrations + bootstraps, drops the migrations pool, then opens the app pool
on the non-superuser role. Both URLs are required at boot — `main.rs` fails
fast (`expect`) if `DATABASE_URL_APP` is missing.

The runtime role is provisioned by migration
`20260509000002_create_app_role.sql` and is explicitly downgraded to
`NOSUPERUSER NOBYPASSRLS` at the end of the migration as a sanity check.

## 7. Per-request transaction model

The `tenant_tx_middleware` opens `state.pool.begin()` for every request that
flows through it, plants both session vars via `set_config(...)` with
`is_local = true`, and stashes the resulting `TenantTx` in
`request.extensions_mut()`. Handlers extract via the `Tenant(mut tt)`
extractor and:

- MUST call `tt.commit().await?` on the success path. Forgetting to commit
  silently rolls back — that is a fail-safe default, not a feature; the
  convention is "always extract + always commit".
- The `Err` path drops `tt` without committing, which sqlx auto-rolls-back
  on `Drop`.

Pool tuning (`crates/infra/src/db/pool.rs`):

- `max_connections = 25`, `min_connections = 2`.
- `SET statement_timeout = '30s'` per connection.
- `SET idle_in_transaction_session_timeout = '60s'` per connection.

Transactions hold their connection for the entire request, so handler
latency directly affects pool contention. The `idle_in_transaction` timeout
is the back-stop against a panicked or stalled handler holding a connection
forever.

## 8. Demo seed (per tenant)

`POST /admin/tenants/{id}/seed-demo` (superadmin only). The handler runs
inside the same admin per-request transaction (which carries
`app.is_superadmin = 'true'`, so RLS `WITH CHECK` accepts inserts into the
target tenant) and calls `seed::seed_demo_for_tenant(&mut tx, tenant_id)`.

- **Idempotent**: re-running on a fully seeded tenant returns HTTP 200 with
  every counter in `summary` at zero. Existing rows are preserved.
- **Demo users**: three global users — `edgar@vandev.mx` (owner),
  `luis@vandev.mx` (manager), `laura@vandev.mx` (operator) — get a
  `user_tenants` membership row in the target tenant. The user records
  themselves are global (re-used across tenants).
- **Audit**: each call appends one `audit_log` row with
  `event = 'tenant.seed_demo'`, `target_tenant_id`, and `metadata` carrying
  the full `SeedSummary` JSON.
- **Frontend**: `/admin/tenants/[id]` renders an enabled "Cargar datos
  demo" button. Click opens a confirmation modal (`seed-demo-modal.tsx`)
  that names the tenant by both `name` and `slug` so a misclick at 2 a.m.
  is hard. Submit is locked while in flight (Escape / outside-click /
  close-X all blocked).

Demo seed is **never** auto-run at boot. It is opt-in per tenant.

## 9. Audit log

Append-only, control-plane (`audit_log`, no RLS, INSERT + SELECT granted to
`vandepot_app`; UPDATE + DELETE intentionally not granted). Captured events:

- `tenant.created`, `tenant.updated`, `tenant.suspended`
- `membership.granted`, `membership.revoked`
- `tenant.seed_demo`
- `impersonation.minted`

`POST /admin/tenants/{id}/impersonate` mints an Access token with
`tenant_id = target`, `is_superadmin = true`, default TTL 15 min (max 60),
and writes the audit row in the same transaction. The minted token lets
the superadmin act AS the tenant via standard tenant-scoped endpoints
without joining `user_tenants`.

## 10. Dev workflow

`make reset-db` (see `backend/MIGRATIONS.md` for the long form):

1. `docker compose down -v` — drops the Postgres volume.
2. `docker compose up -d postgres redis`.
3. Boots `cargo run --bin vandepot-api` once with both seed flags set; the
   boot path runs migrations, bootstraps the superadmin (env-gated), and
   upserts the default tenant (slug `dev`, name `Default Tenant`). Slug
   `default` is reserved by the migration A1 CHECK.
4. Kills the API once `/health` reports ready.

Required env vars (typically loaded from `.env`):

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Superuser; migrations + seed only. |
| `DATABASE_URL_APP` | yes | Non-superuser runtime role. **No silent fallback.** |
| `RUN_SEED_SUPERADMIN` | `make reset-db` forces `true` | Env-gated bootstrap. |
| `RUN_SEED_DEFAULT_TENANT` | `make reset-db` forces `true` | Dev-only. |
| `SUPERADMIN_EMAIL` | required when bootstrap is on | Validated as non-empty. |
| `SUPERADMIN_PASSWORD` | required when bootstrap is on | ≥ 16 chars + ≥ 1 uppercase + ≥ 1 lowercase + ≥ 1 digit. Process exits non-zero before binding the HTTP port if any rule fails. There is no fallback. |
| `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION` | yes | See `.env.example`. |

The end-to-end smoke loop (login superadmin → create tenant → seed-demo →
log in as a seeded user) is documented in the README "Resetting the dev
database" section.

## 11. Out of scope (deferred to a future change)

- Subdomain-based tenant resolution (e.g. `acme.vandepot.app`).
- Self-service tenant signup / public registration.
- Billing, usage metering, plan enforcement.
- Multi-region deploy / tenant data residency.
- Runtime frontend tenant-switcher UI (today: re-login to switch).
- Cross-tenant analytics / reporting dashboards for superadmin.
- Tenant data export and hard-delete tooling.

These were deliberately excluded from the v1 multi-tenant foundation; they
are tracked in the proposal's "Out of Scope" section and on the
`sdd/multi-tenant-foundation/proposal` engram artifact.
