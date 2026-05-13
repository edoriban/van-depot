/**
 * lib/hooks/use-warehouse.ts — SWR detail hook for a single warehouse.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §7.1
 * (Migration pattern). Mirrors `lib/hooks/use-product.ts` precedent.
 *
 * Cache key: `/warehouses/{id}` — invalidated by
 * `useWarehouseActions.updateWarehouse` so this hook revalidates
 * automatically after edits.
 *
 * @example
 *   const { warehouse, isLoading, error, refresh } = useWarehouse(id);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { Warehouse } from '@/types';

export interface UseWarehouseResult {
  warehouse: Warehouse | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<Warehouse | undefined>;
}

export function useWarehouse(
  id: string | null | undefined,
): UseWarehouseResult {
  const key = id ? `/warehouses/${id}` : null;
  const swr = useSWR<Warehouse>(key, (k: string) => api.get<Warehouse>(k));

  const refresh = async () => swr.mutate(undefined, { revalidate: true });

  return {
    warehouse: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
