# VanDepot - Development Commands
# Usage: make [target]

# --- Variables ---
CARGO := cargo
PNPM := pnpm
DOCKER_COMPOSE := docker compose

BACKEND_PORT := 3000
FRONTEND_PORT := 3001

# Colors for output (printf-safe, BSD-compatible)
BLUE := \033[34m
GREEN := \033[32m
YELLOW := \033[33m
NC := \033[0m

.PHONY: help workspace kill dev backend frontend docker-up docker-down install clean test

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
	@printf "$(BLUE)║$(NC)    make frontend       - Next.js frontend (port 3001) $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Docker:$(NC)                                           $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make docker-up      - Start dev services (detached)$(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make docker-down    - Stop dev services            $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╠═══════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║$(NC)  $(GREEN)Utilities:$(NC)                                        $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make install        - Install all dependencies     $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make test           - Run all tests                $(BLUE)║$(NC)\n"
	@printf "$(BLUE)║$(NC)    make clean          - Clean build artifacts        $(BLUE)║$(NC)\n"
	@printf "$(BLUE)╚═══════════════════════════════════════════════════════╝$(NC)\n"
