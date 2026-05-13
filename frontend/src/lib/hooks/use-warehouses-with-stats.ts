/**
 * lib/hooks/use-warehouses-with-stats.ts — SWR list hook for
 * `/warehouses/with-stats` with a fallback to the basic `/warehouses`
 * endpoint when the enriched route is unavailable.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §6
 * (Convenience-wrapper extraction rule); design
 * `sdd/frontend-migration-almacenes/design` §4.1 LOCKED — the fallback lives
 * INSIDE the fetcher so the SWR cache key always matches the current URL
 * shape (`/warehouses/with-stats?page=N&per_page=20`).
 *
 * Cache-key parity: mirrors the URL the legacy `/almacenes` page built
 * inline. SWR dedupe means any in-flight branches reading the same key share
 * the result.
 *
 * @example
 *   const { data, total, isLoading, error, refresh } =
 *     useWarehousesWithStats(page, 20);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type {
  PaginatedResponse,
  Warehouse,
  WarehouseWithStats,
} from '@/types';

export interface UseWarehousesWithStatsResult {
  data: WarehouseWithStats[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<WarehouseWithStats> | undefined>;
}

/**
 * Synthesize zero-valued stats from a plain `Warehouse` record so the page
 * can render uniformly when the enriched endpoint is unavailable.
 */
function withZeroStats(w: Warehouse): WarehouseWithStats {
  return {
    ...w,
    locations_count: 0,
    products_count: 0,
    total_quantity: 0,
    low_stock_count: 0,
    critical_count: 0,
    last_movement_at: null,
  };
}

/**
 * Fetcher with the enriched → basic fallback. The SWR cache key never
 * changes — only the network call swaps endpoints internally.
 */
async function fetcher(
  key: string,
): Promise<PaginatedResponse<WarehouseWithStats>> {
  try {
    return await api.get<PaginatedResponse<WarehouseWithStats>>(key);
  } catch {
    const basicKey = key.replace(
      '/warehouses/with-stats',
      '/warehouses',
    );
    const basic = await api.get<PaginatedResponse<Warehouse>>(basicKey);
    return {
      ...basic,
      data: basic.data.map(withZeroStats),
    };
  }
}

export function useWarehousesWithStats(
  page: number,
  perPage = 20,
): UseWarehousesWithStatsResult {
  const key = `/warehouses/with-stats?page=${page}&per_page=${perPage}`;
  const swr = useSWR<PaginatedResponse<WarehouseWithStats>>(key, fetcher);

  const data = swr.data?.data ?? [];
  const total = swr.data?.total ?? 0;

  const refresh = async () =>
    swr.mutate(undefined, { revalidate: true });

  return {
    data,
    total,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
