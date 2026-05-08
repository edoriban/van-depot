/**
 * lib/api/tenants.ts — typed client for `/admin/tenants/*` endpoints (A19).
 *
 * See `frontend/src/CONVENTIONS.md` §3 (data fetching with SWR) and §4
 * (mutations live outside SWR). All functions thread the auth token via
 * `lib/api-mutations.ts`'s `api.*` helpers (which re-use the in-memory
 * Bearer + cookie-refresh wrapper).
 *
 * Source of truth — backend handlers:
 *   - `backend/crates/api/src/routes/admin/tenants.rs`
 *   - `backend/crates/api/src/routes/admin/memberships.rs`
 */
import { api } from '@/lib/api-mutations';
import type { Tenant, TenantRole } from '@/types';

// ── DTO types (mirror backend wire shapes) ──────────────────────────────────

export interface CreateTenantInput {
  slug: string;
  name: string;
}

export interface UpdateTenantInput {
  name?: string;
  status?: 'active' | 'suspended';
}

export interface MembershipResponse {
  user_id: string;
  tenant_id: string;
  role: TenantRole;
  created_at: string;
  user_email: string | null;
}

export interface GrantMembershipInput {
  user_id: string;
  role: TenantRole;
}

/**
 * Per-tenant demo seed counters returned by `POST /admin/tenants/{id}/seed-demo`.
 * Each counter increments only when an `INSERT ... ON CONFLICT DO NOTHING
 * RETURNING` actually inserted a row, so an idempotent re-run yields all
 * zeros (and the UI shows the "already present" message).
 *
 * Source of truth: `backend/crates/infra/src/seed/mod.rs::SeedSummary`.
 */
export interface SeedDemoSummary {
  warehouses: number;
  locations: number;
  categories: number;
  suppliers: number;
  products: number;
  recipes: number;
  work_orders: number;
  purchase_orders: number;
  cycle_counts: number;
  notifications: number;
  demo_users: number;
  memberships: number;
}

export interface SeedDemoResponse {
  tenant: { id: string; slug: string; name: string };
  summary: SeedDemoSummary;
}

// ── Fetcher functions ───────────────────────────────────────────────────────

/** `GET /admin/tenants?include_suspended=...`. Returns active tenants by default. */
export function listTenants(includeSuspended = false): Promise<Tenant[]> {
  const qs = includeSuspended ? '?include_suspended=true' : '';
  return api.get<Tenant[]>(`/admin/tenants${qs}`);
}

/** `GET /admin/tenants/{id}`. 404 → throws ApiError. */
export function getTenant(id: string): Promise<Tenant> {
  return api.get<Tenant>(`/admin/tenants/${id}`);
}

/** `POST /admin/tenants`. 409 → slug collision; 422 → validation. */
export function createTenant(input: CreateTenantInput): Promise<Tenant> {
  return api.post<Tenant>('/admin/tenants', input);
}

/** `PATCH /admin/tenants/{id}` — partial update of name/status. */
export function updateTenant(id: string, input: UpdateTenantInput): Promise<Tenant> {
  return api.patch<Tenant>(`/admin/tenants/${id}`, input);
}

/** `DELETE /admin/tenants/{id}` — soft-delete (idempotent → 204). */
export function deleteTenant(id: string): Promise<void> {
  return api.del<void>(`/admin/tenants/${id}`);
}

/** `GET /admin/tenants/{id}/memberships` — superadmin-only list. */
export function listMemberships(tenantId: string): Promise<MembershipResponse[]> {
  return api.get<MembershipResponse[]>(`/admin/tenants/${tenantId}/memberships`);
}

/** `POST /admin/tenants/{id}/memberships` — grant or upsert reactivate. */
export function grantMembership(
  tenantId: string,
  input: GrantMembershipInput,
): Promise<MembershipResponse> {
  return api.post<MembershipResponse>(
    `/admin/tenants/${tenantId}/memberships`,
    input,
  );
}

/** `DELETE /admin/tenants/{id}/memberships/{user_id}` — idempotent revoke. */
export function revokeMembership(
  tenantId: string,
  userId: string,
): Promise<void> {
  return api.del<void>(`/admin/tenants/${tenantId}/memberships/${userId}`);
}

/**
 * `POST /admin/tenants/{id}/seed-demo` — superadmin-only per-tenant demo seed
 * (Phase D / D2). Idempotent: a second call returns the same envelope shape
 * with all-zero `summary` counters.
 */
export function seedDemoTenant(tenantId: string): Promise<SeedDemoResponse> {
  return api.post<SeedDemoResponse>(`/admin/tenants/${tenantId}/seed-demo`);
}

// ── SWR cache keys ─────────────────────────────────────────────────────────
//
// Exported so callers can `import { tenantsKey } from '@/lib/api/tenants'` and
// pass to `mutate(...)` for invalidation after mutations.

export const tenantsKey = (includeSuspended: boolean): string =>
  includeSuspended ? '/admin/tenants?include_suspended=true' : '/admin/tenants';

export const tenantKey = (id: string): string => `/admin/tenants/${id}`;

export const membershipsKey = (tenantId: string): string =>
  `/admin/tenants/${tenantId}/memberships`;
