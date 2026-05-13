/**
 * lib/hooks/use-warehouse-movements.ts — paginated movements fetch scoped to
 * a warehouse.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.4 LOCKED.
 *
 * Cache key parity: matches the legacy
 * `/movements?page=N&per_page=20&warehouse_id={id}` URL shape so SWR dedupe
 * holds across consumers.
 *
 * @example
 *   const { data, total, isLoading } =
 *     useWarehouseMovements(warehouseId, page, 20);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { Movement, PaginatedResponse } from '@/types';

export interface UseWarehouseMovementsResult {
  data: Movement[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<Movement> | undefined>;
}

export function useWarehouseMovements(
  warehouseId: string | null | undefined,
  page: number,
  perPage = 20,
): UseWarehouseMovementsResult {
  // URL order matches legacy `[id]/page.tsx`:
  //   `?page=N&per_page=20&warehouse_id={id}` — preserved verbatim for
  //   SWR cache-key parity.
  const key = warehouseId
    ? `/movements?page=${page}&per_page=${perPage}&warehouse_id=${warehouseId}`
    : null;
  const swr = useSWR<PaginatedResponse<Movement>>(
    key,
    (k: string) => api.get<PaginatedResponse<Movement>>(k),
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
