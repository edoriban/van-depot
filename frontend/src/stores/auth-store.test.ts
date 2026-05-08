/**
 * stores/auth-store.test.ts — A16 dispatch / persistence tests.
 *
 * Status: WRITTEN, NOT RUN. The frontend does not yet have a unit-test
 * runner configured (only `playwright` for e2e). To activate:
 *   1. `pnpm add -D vitest @vitest/ui jsdom`
 *   2. Add `"test": "vitest"` to `package.json` scripts.
 *   3. Add `vitest.config.ts` with `test.environment = 'jsdom'`.
 *
 * The vitest globals are loosely typed below so this file typechecks even
 * before the runner is installed; once vitest is added, replace the local
 * declarations with `import { describe, it, expect, beforeEach } from 'vitest';`.
 *
 * Source of truth: `sdd/multi-tenant-foundation/design` §9 + task A16
 * acceptance criteria.
 */

// Loose locally-typed stand-ins for vitest globals. Replace with real imports
// when vitest is installed.
type ExpectMatchers = {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toBeDefined(): void;
  toEqual(expected: unknown): void;
  toHaveLength(n: number): void;
};
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const beforeEach: (fn: () => void | Promise<void>) => void;
declare const expect: (value: unknown) => ExpectMatchers;

import { useAuthStore } from './auth-store';
import type { LoginResponse, LoginResponseFinal } from '@/types';

const SUPERADMIN_FINAL: LoginResponseFinal = {
  access_token: 'access.super',
  refresh_token: 'refresh.super',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@vandev.mx',
    name: 'Admin',
    is_superadmin: true,
  },
  tenant: null,
  role: null,
  is_superadmin: true,
};

const SINGLE_TENANT_FINAL: LoginResponseFinal = {
  access_token: 'access.single',
  refresh_token: 'refresh.single',
  user: {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'owner@acme.com',
    name: 'Acme Owner',
    is_superadmin: false,
  },
  tenant: {
    id: '00000000-0000-0000-0000-0000000000aa',
    slug: 'acme',
    name: 'Acme Co',
  },
  role: 'owner',
  is_superadmin: false,
};

const MULTI_TENANT: LoginResponse = {
  intermediate_token: 'intermediate.xyz',
  memberships: [
    {
      tenant_id: '00000000-0000-0000-0000-0000000000aa',
      tenant_slug: 'acme',
      tenant_name: 'Acme Co',
      role: 'manager',
    },
    {
      tenant_id: '00000000-0000-0000-0000-0000000000bb',
      tenant_slug: 'globex',
      tenant_name: 'Globex Corp',
      role: 'operator',
    },
  ],
};

beforeEach(() => {
  useAuthStore.getState().logout();
});

describe('auth-store: login dispatch', () => {
  it('Final superadmin sets isSuperadmin and clears tenant fields', () => {
    useAuthStore.getState().login(SUPERADMIN_FINAL);
    const s = useAuthStore.getState();
    expect(s.isSuperadmin).toBe(true);
    expect(s.accessToken).toBe('access.super');
    expect(s.refreshToken).toBe('refresh.super');
    expect(s.activeTenant).toBeNull();
    expect(s.user?.role).toBe('superadmin');
    expect(s.intermediateToken).toBeNull();
    expect(s.availableTenants).toEqual([]);
  });

  it('Final single-tenant maps owner→owner and sets activeTenant', () => {
    useAuthStore.getState().login(SINGLE_TENANT_FINAL);
    const s = useAuthStore.getState();
    expect(s.isSuperadmin).toBe(false);
    expect(s.accessToken).toBe('access.single');
    expect(s.activeTenant).toEqual({
      id: '00000000-0000-0000-0000-0000000000aa',
      slug: 'acme',
      name: 'Acme Co',
    });
    expect(s.user?.role).toBe('owner');
    expect(s.intermediateToken).toBeNull();
    expect(s.availableTenants).toEqual([]);
  });

  it('Final manager role maps to legacy warehouse_manager', () => {
    useAuthStore
      .getState()
      .login({ ...SINGLE_TENANT_FINAL, role: 'manager' });
    expect(useAuthStore.getState().user?.role).toBe('warehouse_manager');
  });

  it('Final operator role maps to legacy operator', () => {
    useAuthStore
      .getState()
      .login({ ...SINGLE_TENANT_FINAL, role: 'operator' });
    expect(useAuthStore.getState().user?.role).toBe('operator');
  });

  it('MultiTenant sets intermediate + availableTenants and clears final fields', () => {
    useAuthStore.getState().login(MULTI_TENANT);
    const s = useAuthStore.getState();
    expect(s.intermediateToken).toBe('intermediate.xyz');
    expect(s.availableTenants).toHaveLength(2);
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.activeTenant).toBeNull();
    expect(s.isSuperadmin).toBe(false);
  });
});

describe('auth-store: selectTenant', () => {
  it('clears intermediate + sets activeTenant + tokens', () => {
    useAuthStore.getState().login(MULTI_TENANT);
    expect(useAuthStore.getState().intermediateToken).toBe('intermediate.xyz');

    useAuthStore.getState().selectTenant(SINGLE_TENANT_FINAL);
    const s = useAuthStore.getState();
    expect(s.intermediateToken).toBeNull();
    expect(s.availableTenants).toEqual([]);
    expect(s.accessToken).toBe('access.single');
    expect(s.activeTenant?.slug).toBe('acme');
    expect(s.user?.email).toBe('owner@acme.com');
  });
});

describe('auth-store: refresh', () => {
  it('updates tokens but preserves the user identity', () => {
    useAuthStore.getState().login(SINGLE_TENANT_FINAL);
    const beforeUserId = useAuthStore.getState().user?.id;
    expect(beforeUserId).toBeDefined();

    useAuthStore.getState().refresh({
      access_token: 'access.new',
      refresh_token: 'refresh.new',
    });

    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('access.new');
    expect(s.refreshToken).toBe('refresh.new');
    expect(s.user?.id).toBe(beforeUserId);
    expect(s.user?.email).toBe('owner@acme.com');
  });

  it('with explicit nextRole updates legacy role mapping', () => {
    useAuthStore.getState().login(SINGLE_TENANT_FINAL);
    useAuthStore.getState().refresh({
      access_token: 'access.new',
      refresh_token: 'refresh.new',
      role: 'operator',
    });
    expect(useAuthStore.getState().user?.role).toBe('operator');
  });
});

describe('auth-store: logout', () => {
  it('clears every long-lived field', () => {
    useAuthStore.getState().login(SINGLE_TENANT_FINAL);
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.activeTenant).toBeNull();
    expect(s.availableTenants).toEqual([]);
    expect(s.intermediateToken).toBeNull();
    expect(s.isSuperadmin).toBe(false);
  });
});

describe('auth-store: clearTenant', () => {
  it('only clears tenant-related fields, preserves tokens + user', () => {
    useAuthStore.getState().login(SINGLE_TENANT_FINAL);
    useAuthStore.getState().clearTenant();
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('access.single');
    expect(s.user?.id).toBe('00000000-0000-0000-0000-000000000002');
    expect(s.activeTenant).toBeNull();
    expect(s.availableTenants).toEqual([]);
    expect(s.intermediateToken).toBeNull();
  });
});
