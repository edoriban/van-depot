# VanDepot

Sistema de gestión de almacén (WMS) para PyMEs y negocios de oficios en México.

## Stack

- **Backend**: Rust (Axum) — API REST de alto rendimiento
- **Frontend**: Next.js 15 + shadcn/ui — PWA mobile-first
- **Base de datos**: PostgreSQL 17
- **Cache**: Redis 7

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
