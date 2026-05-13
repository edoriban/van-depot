/**
 * lib/hooks/use-warehouse-actions.ts — typed mutation bundle for the
 * almacenes LIST page (and forward-compat for the DETAIL page header).
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.6 LOCKED — single
 * bundle (mirrors `useProductActions`).
 *
 * Each mutation wraps the corresponding `api.post/put/del` and invalidates
 * the relevant SWR cache via `mutate(...)` so consumers re-fetch on next
 * mount (and any active matching key revalidates immediately). Both the
 * enriched `/warehouses/with-stats` AND basic `/warehouses` prefixes are
 * invalidated because the list hook uses the with-stats key but the detail
 * page reads `/warehouses/{id}` directly.
 */
'use client';

import { mutate as globalMutate } from 'swr';
import { api } from '@/lib/api-mutations';
import type { Warehouse } from '@/types';
import type { WarehouseFormInput } from '@/features/almacenes/schema';

export interface UseWarehouseActionsResult {
  createWarehouse: (input: WarehouseFormInput) => Promise<Warehouse>;
  updateWarehouse: (
    id: string,
    input: WarehouseFormInput,
  ) => Promise<Warehouse>;
  deleteWarehouse: (id: string) => Promise<void>;
}

/**
 * Invalidate every active SWR key whose URL starts with the given prefix.
 * Used so paginated/filtered list views (e.g.
 * `/warehouses/with-stats?page=2&per_page=20`) all revalidate after a
 * mutation without hardcoding every filter combination.
 */
function invalidatePrefix(prefix: string): Promise<unknown> {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    undefined,
    { revalidate: true },
  );
}

/**
 * Convert the parsed Zod input into the API payload shape. Matches the
 * legacy `/almacenes/page.tsx` inline submit handler:
 *   `{ name, address: address || undefined }`.
 */
function buildPayload(input: WarehouseFormInput): Record<string, unknown> {
  return {
    name: input.name,
    address: input.address,
  };
}

export function useWarehouseActions(): UseWarehouseActionsResult {
  return {
    createWarehouse: async (input) => {
      const created = await api.post<Warehouse>(
        '/warehouses',
        buildPayload(input),
      );
      await Promise.all([
        invalidatePrefix('/warehouses/with-stats'),
        invalidatePrefix('/warehouses?'),
        invalidatePrefix('/warehouses'),
      ]);
      return created;
    },
    updateWarehouse: async (id, input) => {
      const updated = await api.put<Warehouse>(
        `/warehouses/${id}`,
        buildPayload(input),
      );
      await Promise.all([
        invalidatePrefix('/warehouses/with-stats'),
        invalidatePrefix('/warehouses?'),
        globalMutate(`/warehouses/${id}`),
        invalidatePrefix('/warehouses'),
      ]);
      return updated;
    },
    deleteWarehouse: async (id) => {
      await api.del<void>(`/warehouses/${id}`);
      await Promise.all([
        invalidatePrefix('/warehouses/with-stats'),
        invalidatePrefix('/warehouses?'),
        invalidatePrefix('/warehouses'),
      ]);
    },
  };
}
