# VanDepot - Development Commands
# Usage: make [target]

# --- Variables ---
CARGO := cargo
PNPM := pnpm
DOCKER_COMPOSE := docker compose

BACKEND_PORT := 3100
FRONTEND_PORT := 3201

# Colors for output (printf-safe, BSD-compatible)
BLUE := \033[34m
GREEN := \033[32m
YELLOW := \033[33m
NC := \033[0m

.PHONY: help workspace kill dev backend frontend docker-up docker-down install clean test reset-db

# Default target
all: help

# --- Workspace ---

workspace:
	@printf "$(BLUE)Starting dev workspace...$(NC)\n"
	@zellij kill-session vandepot 2>/dev/null || true
	@zellij delete-session vandepot 2>/dev/null || true
	@zellij --session vandepot --new-session-with-layout dev.kdl

kill:
	@printf "$(YELLOW)Killing workspace...$(NC)\n"
	@zellij kill-session vandepot 2>/dev/null || printf "No active session 'vandepot' to kill.\n"
	@zellij delete-session vandepot 2>/dev/null || true

# --- Development ---

dev:
	@printf "$(BLUE)🚀 Starting VanDepot development environment...$(NC)\n"
	@printf "$(GREEN)  Backend:  http://localhost:$(BACKEND_PORT)$(NC)\n"
	@printf "$(GREEN)  Frontend: http://localhost:$(FRONTEND_PORT)$(NC)\n"
	@trap 'printf "\n$(YELLOW)Shutting down...$(NC)\n"; kill 0' INT TERM; \
		$(MAKE) backend & \
		$(MAKE) frontend & \
		wait

backend:
	@printf "$(BLUE)🦀 Starting Rust backend (cargo-watch)...$(NC)\n"
	@if ! command -v cargo-watch >/dev/null 2>&1; then \
		printf "$(YELLOW)⚠️  cargo-watch not found. Install it with:$(NC)\n"; \
		printf "    cargo install cargo-watch\n"; \
		exit 1; \
	fi
	cd backend && cargo watch -x run

frontend:
	@printf "$(BLUE)⚡ Starting Next.js frontend dev server...$(NC)\n"
	cd frontend && $(PNPM) dev --port $(FRONTEND_PORT)

# --- Docker ---

docker-up:
	@printf "$(BLUE)🐳 Starting dev services with Docker...$(NC)\n"
	$(DOCKER_COMPOSE) up -d
	@printf "$(GREEN)✅ Dev services running$(NC)\n"

docker-down:
	@printf "$(BLUE)🛑 Stopping dev services...$(NC)\n"
	$(DOCKER_COMPOSE) down

# --- Dev DB reset (DESTRUCTIVE) ---

# reset-db drops the Postgres volume, brings services back up, applies all
# migrations, then seeds the superadmin and the default dev tenant.
#
# Required env vars (typically loaded from .env):
#   SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD (>=16 chars, mixed case + digit)
#
# RUN_SEED_SUPERADMIN and RUN_SEED_DEFAULT_TENANT are forced to "true" by this
# target so the boot path performs the seeds. After reset, the DB has exactly:
#   - 1 row in `tenants` (slug='dev', name='Default Tenant')
#   - 1 row in `users`   (is_superadmin=true)
# All other tenant-scoped tables are empty. Demo data is seeded per-tenant via
# the admin endpoint POST /admin/tenants/{id}/seed-demo (Phase D).
reset-db:
	@printf "$(YELLOW)⚠️  WARNING: this WIPES the dev database (all local data lost).$(NC)\n"
	@printf "$(YELLOW)   Press Ctrl-C within 3 seconds to abort...$(NC)\n"
	@sleep 3
	@printf "$(BLUE)🗑️  Dropping Postgres volume vandepot-postgres_data...$(NC)\n"
	$(DOCKER_COMPOSE) down -v
	@printf "$(BLUE)🐳 Bringing services back up...$(NC)\n"
	$(DOCKER_COMPOSE) up -d postgres redis
	@printf "$(BLUE)⏳ Waiting for postgres to be ready...$(NC)\n"
	@until $(DOCKER_COMPOSE) exec -T postgres pg_isready -U $${POSTGRES_USER:-vandepot} >/dev/null 2>&1; do \
		printf "."; sleep 1; \
	done; printf "\n"
	@printf "$(BLUE)🌱 Running migrations + seeding superadmin + default tenant...$(NC)\n"
	@if [ -z "$$SUPERADMIN_EMAIL" ] || [ -z "$$SUPERADMIN_PASSWORD" ]; then \
		printf "$(YELLOW)❌ SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set (export them or put them in .env).$(NC)\n"; \
		exit 1; \
	fi
	@# Boot the api binary once. main.rs runs migrations + seed BEFORE
	@# axum::serve, so by the time the listener is up we know seeding has
	@# completed. We then kill the process — the dev DB now has migrations +
	@# superadmin + default tenant. Re-running this target without a volume
	@# drop is idempotent (every seed step is upsert-on-conflict).
	cd backend && \
		RUN_SEED_SUPERADMIN=true \
		RUN_SEED_DEFAULT_TENANT=true \
		bash -c '\
			$(CARGO) run --bin vandepot-api --quiet & \
			api_pid=$$!; \
			for i in $$(seq 1 60); do \
				if curl -fsS "http://localhost:$${BACKEND_PORT:-3100}/health" >/dev/null 2>&1; then \
					kill $$api_pid 2>/dev/null; wait $$api_pid 2>/dev/null; exit 0; \
				fi; \
				sleep 1; \
			done; \
			kill $$api_pid 2>/dev/null; wait $$api_pid 2>/dev/null; \
			echo "WARN: api did not report ready in 60s; assuming migrations + seed completed"; \
		'
	@printf "$(GREEN)✅ Dev database reset.$(NC)\n"
	@printf "$(GREEN)   Tenant:     slug='dev', name='Default Tenant'$(NC)\n"
	@printf "$(GREEN)   Superadmin: $${SUPERADMIN_EMAIL}$(NC)\n"
	@printf "$(GREEN)   Start the API with 'make backend' or 'make dev'.$(NC)\n"

# --- Utilities ---

install:
	@printf "$(BLUE)📦 Installing dependencies...$(NC)\n"
	@printf "$(GREEN)  → Building Rust backend...$(NC)\n"
	cd backend && $(CARGO) build
	@printf "$(GREEN)  → Installing frontend packages...$(NC)\n"
	cd frontend && $(PNPM) install
	@printf "$(GREEN)✅ All dependencies installed$(NC)\n"

clean:
	@printf "$(YELLOW)🧹 Cleaning build artifacts...$(NC)\n"
	cd backend && $(CARGO) clean
	rm -rf frontend/.next
	@printf "$(GREEN)✅ Cleanup complete$(NC)\n"

test:
	@printf "$(BLUE)🧪 Running tests...$(NC)\n"
	@printf "$(GREEN)  → Backend tests...$(NC)\n"
	cd backend && $(CARGO) test
	@if [ -f frontend/package.json ] && grep -q '"test"' frontend/package.json 2>/dev/null; then \
		printf "$(GREEN)  → Frontend tests...$(NC)\n"; \
		cd frontend && $(PNPM) test; \
	else \
		printf "$(YELLOW)  → No frontend test script found, skipping$(NC)\n"; \
	fi
	@printf "$(GREEN)✅ All tests complete$(NC)\n"

# --- Help ---

help:
	@printf "$(BLUE)╔═══════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(BLUE)║         VanDepot Development Commands                ║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Workspace:$(NC)                                        $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make workspace     - Zellij dev session            $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make kill           - Kill Zellij session           $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Development:$(NC)                                      $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make dev            - Start backend + frontend     $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make backend        - Rust backend (cargo-watch)   $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make frontend       - Next.js frontend (port 3201) $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Docker:$(NC)                                           $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make docker-up      - Start dev services (detached)$(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make docker-down    - Stop dev services            $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make reset-db       - WIPE + reseed dev DB (!)      $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Utilities:$(NC)                                        $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make install        - Install all dependencies     $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make test           - Run all tests                $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make clean          - Clean build artifacts        $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╚═══════════════════════════════════════════════════════╝$(NC)\n"
