# VanDepot

Sistema de gestión de almacén (WMS) para PyMEs y negocios de oficios en México.

## Stack

- **Backend**: Rust (Axum) — API REST de alto rendimiento
- **Frontend**: Next.js 15 + shadcn/ui — PWA mobile-first
- **Base de datos**: PostgreSQL 17 (con Row-Level Security)
- **Cache**: Redis 7

## Multi-tenant

VanDepot es multi-tenant: una sola instancia atiende a varios tenants
aislados a nivel de schema (`tenant_id` en cada tabla de dominio), a nivel
de base de datos (RLS de Postgres + rol de runtime no-superuser) y a nivel
de aplicación (cada query de repositorio incluye `WHERE tenant_id = $N`).
La autenticación es JWT y el `tenant_id` activo viaja en el access token.

- Login es de **dos pasos** cuando un usuario tiene más de una membership:
  `/auth/login` devuelve un `intermediate_token` (60 s TTL) y la lista de
  memberships; el cliente intercambia en `/auth/select-tenant`.
- Los tenants se crean **únicamente** por superadmin desde el panel
  `/admin/tenants`.
- Los datos demo se cargan **por tenant** desde el detalle de tenant
  (`POST /admin/tenants/{id}/seed-demo`); nunca se siembran en el arranque.

Detalles completos (RLS, ciclo de request, audit log, impersonación,
workflow dev): ver [`docs/multi-tenant.md`](docs/multi-tenant.md).

## Desarrollo

### Requisitos

- Rust (latest stable)
- Node.js 20+ / pnpm
- Docker + Docker Compose
- Zellij (terminal multiplexer)

### Inicio rápido

```bash
# Iniciar workspace de desarrollo
make workspace

# O manualmente:
make docker-up    # Levantar servicios (PostgreSQL, Redis)
make install      # Instalar dependencias
make dev          # Iniciar backend + frontend
```

## Resetting the dev database

> **WARNING**: `make reset-db` wipes the local Postgres volume entirely. All
> rows in the dev DB are lost — including any local work that was not pushed
> upstream. There is no undo. Multi-tenant foundation work uses the
> drop-and-reseed strategy (see `backend/MIGRATIONS.md`).

After a reset the dev DB contains exactly two seeded rows:

- 1 row in `tenants` — slug `dev`, name `Default Tenant`.
- 1 row in `users` — the superadmin (identified by `is_superadmin = true`).

All other tenant-scoped tables (`warehouses`, `products`, `inventory`, …) are
empty. Demo data is **not** seeded by `make reset-db`; it lands per-tenant via
`POST /admin/tenants/{id}/seed-demo` (see Phase D of the multi-tenant
foundation plan).

### Required env vars

`make reset-db` (and the API binary in general) read from `.env`. The
runtime requires **two** database URLs because the role split is what makes
RLS actually fire (Postgres superusers bypass RLS regardless of `FORCE`):

```bash
# Superuser — migrations + seed at boot ONLY. Never serves runtime traffic.
DATABASE_URL=postgresql://vandepot:vandepot@localhost:5438/vandepot

# Non-superuser runtime role — provisioned by migration
# 20260509000002_create_app_role.sql. Required at boot (no silent fallback).
DATABASE_URL_APP=postgresql://vandepot_app:vandepot_app@localhost:5438/vandepot

RUN_SEED_SUPERADMIN=true        # forced by reset-db
RUN_SEED_DEFAULT_TENANT=true    # forced by reset-db
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=<>=16 chars, mixed case + at least 1 digit>
```

If `SUPERADMIN_EMAIL` or `SUPERADMIN_PASSWORD` is missing or empty,
`make reset-db` exits non-zero before touching the volume. The API binary
also exits non-zero if `SUPERADMIN_PASSWORD` is shorter than 16 chars or
lacks the required character classes (no fallback to a hardcoded password).

### Why slug `dev` and not `default`

Migration `20260507000001_create_tenants.sql` codifies a reserved-slug
CHECK that rejects `default` (alongside `admin`, `api`, `www`, …). Since
that migration is already applied, the dev seed uses `dev` instead. The
trade-off is documented in `backend/MIGRATIONS.md`.

## Estructura

```
van-depot/
├── backend/        # Rust API (Cargo workspace)
│   └── crates/
│       ├── api/    # HTTP layer (Axum)
│       ├── domain/ # Lógica de negocio
│       └── infra/  # BD, servicios externos
├── frontend/       # Next.js 15 + shadcn
├── docker-compose.yml
├── Makefile
└── dev.kdl         # Zellij layout
```

## Licencia

MIT © VanDev
