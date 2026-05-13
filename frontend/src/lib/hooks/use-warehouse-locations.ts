/**
 * lib/hooks/use-warehouse-locations.ts — paginated locations tree fetch for
 * the `/almacenes/[id]` DETAIL page Ubicaciones tab.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.3 LOCKED — cache key
 * preserves the legacy URL shape `?all=true&page=1&per_page=500` (D5 cache-
 * key parity).
 *
 * The tree assumes all-or-nothing (recursive nodes need every descendant
 * loaded); we hardcode `perPage = 500` by default but expose a config
 * field per design §4.3 in case a future tenant outgrows it.
 *
 * @example
 *   const { data: locations, total, isLoading, refresh } =
 *     useWarehouseLocations(warehouseId);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { Location, PaginatedResponse } from '@/types';

export interface UseWarehouseLocationsResult {
  data: Location[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<Location> | undefined>;
}

export function useWarehouseLocations(
  warehouseId: string | null | undefined,
  opts: { perPage?: number } = {},
): UseWarehouseLocationsResult {
  const perPage = opts.perPage ?? 500;
  const key = warehouseId
    ? `/warehouses/${warehouseId}/locations?all=true&page=1&per_page=${perPage}`
    : null;
  const swr = useSWR<PaginatedResponse<Location>>(key, (k: string) =>
    api.get<PaginatedResponse<Location>>(k),
  );

  const refresh = async () =>
    swr.mutate(undefined, { revalidate: true });

  return {
    data: swr.data?.data ?? [],
    total: swr.data?.total ?? 0,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
