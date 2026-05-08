/**
 * stores/auth-store.ts — multi-tenant aware auth store.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) — this
 * is one of the rare singletons that justifies `persist` middleware (auth
 * tokens + active tenant identity must survive page reloads).
 *
 * Source of truth: `sdd/multi-tenant-foundation/design` §9 (Frontend
 * changes) + spec "Frontend tenant context".
 *
 * Dispatch summary for `login(response)`:
 *   - `Final` (access_token present)  → tokens + user + activeTenant + role
 *                                       + isSuperadmin; clear intermediate +
 *                                       availableTenants.
 *   - `MultiTenant` (intermediate_token present) → intermediateToken +
 *                                       availableTenants; clear final fields.
 *
 * The `intermediateToken` is in-memory ONLY (60s TTL on the backend) — see
 * `partialize` below.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ActiveTenant,
  AvailableTenant,
  LoginResponse,
  LoginResponseFinal,
  TenantRole,
  User,
  UserRole,
} from '@/types';

/** Map a tenant role + superadmin flag to the legacy coarse `UserRole`. */
function deriveLegacyRole(
  isSuperadmin: boolean,
  role: TenantRole | null | undefined,
): UserRole | undefined {
  if (isSuperadmin) return 'superadmin';
  switch (role) {
    case 'owner':
      return 'owner';
    case 'manager':
      return 'warehouse_manager';
    case 'operator':
      return 'operator';
    default:
      return undefined;
  }
}

/** Build a `User` from a `Final` login response. */
function userFromFinal(r: LoginResponseFinal): User {
  return {
    id: r.user.id,
    email: r.user.email,
    name: r.user.name,
    role: deriveLegacyRole(r.is_superadmin, r.role),
    is_superadmin: r.is_superadmin,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

interface AuthState {
  user: User | null;

  /** Final-session access token (Bearer). Persisted alongside refresh. */
  accessToken: string | null;
  /** Final-session refresh token. Persisted; rotated on `/auth/refresh`. */
  refreshToken: string | null;
  /**
   * Short-lived (60s) intermediate token. Issued only when the user has >1
   * memberships. NEVER persisted (see `partialize`) — irrelevant after
   * `/auth/select-tenant` consumes it.
   */
  intermediateToken: string | null;

  /** Currently selected tenant identity. `null` for superadmin or pre-select. */
  activeTenant: ActiveTenant | null;
  /** Membership list awaiting selection. `[]` once a tenant is chosen. */
  availableTenants: AvailableTenant[];
  /** Convenience flag mirroring `LoginResponse.Final.is_superadmin`. */
  isSuperadmin: boolean;

  /** Set by `<AuthInitializer>` once initial rehydration is complete. */
  isHydrated: boolean;

  /** Dispatch on a fresh `/auth/login` response (Final OR MultiTenant). */
  login: (response: LoginResponse) => void;
  /**
   * Dispatch after `POST /auth/select-tenant` completes — same shape as the
   * Final branch of `login` but additionally clears the intermediate token
   * + availableTenants list.
   */
  selectTenant: (response: LoginResponseFinal) => void;
  /**
   * Dispatch after `POST /auth/refresh`. Updates tokens + role (which can
   * change between sessions if the backend re-evaluates membership) but
   * preserves the existing `user` shape (refresh response carries no user
   * payload). Pass `nextRole` only when the backend round-trips it; if
   * `undefined`, the existing role is kept.
   */
  refresh: (params: {
    access_token: string;
    refresh_token: string;
    role?: TenantRole | null;
  }) => void;

  /** Clear everything — tokens, user, tenant info, intermediate. */
  logout: () => void;
  /**
   * Clear tenant-related fields only (used when /auth/refresh fails with a
   * `membership_not_found_or_inactive` so the user is bounced to /login but
   * we want to drop active-tenant state explicitly).
   */
  clearTenant: () => void;

  /** Hydration handshake (called once by `<AuthInitializer>`). */
  setHydrated: () => void;
  /** Mirror legacy setter; some flows still call it directly. */
  setUser: (user: User | null) => void;
  /** Mirror legacy setter for tests / refresh paths. */
  setAccessToken: (token: string | null) => void;
}

const initialState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  intermediateToken: null,
  activeTenant: null,
  availableTenants: [] as AvailableTenant[],
  isSuperadmin: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...initialState,
      isHydrated: false,

      login: (response) => {
        if ('access_token' in response) {
          set({
            user: userFromFinal(response),
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            activeTenant: response.tenant,
            isSuperadmin: response.is_superadmin,
            intermediateToken: null,
            availableTenants: [],
          });
          return;
        }
        // MultiTenant branch — login response carries no user payload yet.
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          activeTenant: null,
          isSuperadmin: false,
          intermediateToken: response.intermediate_token,
          availableTenants: response.memberships,
        });
      },

      selectTenant: (response) => {
        set({
          user: userFromFinal(response),
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          activeTenant: response.tenant,
          isSuperadmin: response.is_superadmin,
          intermediateToken: null,
          availableTenants: [],
        });
      },

      refresh: ({ access_token, refresh_token, role }) =>
        set((state) => {
          // Preserve user identity but update tokens + (optionally) role.
          const nextUser =
            state.user === null
              ? state.user
              : role === undefined
                ? state.user
                : {
                    ...state.user,
                    role: deriveLegacyRole(state.isSuperadmin, role),
                  };
          return {
            accessToken: access_token,
            refreshToken: refresh_token,
            user: nextUser,
          };
        }),

      logout: () => set({ ...initialState }),

      clearTenant: () =>
        set({
          activeTenant: null,
          availableTenants: [],
          intermediateToken: null,
        }),

      setHydrated: () => set({ isHydrated: true }),
      setUser: (user) => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
    }),
    {
      name: 'vandepot-auth',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          // SSR / Node test stub. Zustand's persist tolerates a no-op storage.
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      // Persist only the long-lived auth surface. `intermediateToken` is
      // explicitly excluded — the backend issues it with a 60s TTL and it is
      // single-use against /auth/select-tenant; persisting it would be a
      // security smell.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        activeTenant: state.activeTenant,
        isSuperadmin: state.isSuperadmin,
      }),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated as soon as persist has rehydrated the snapshot.
        // `<AuthInitializer>` may also call `setHydrated()` after a /me
        // round-trip; either path is safe — `set({ isHydrated: true })` is
        // idempotent.
        state?.setHydrated();
      },
    },
  ),
);
