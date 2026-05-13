/**
 * lib/hooks/use-warehouse-inventory.ts — paginated inventory fetch scoped to
 * a warehouse.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.4 LOCKED.
 *
 * Cache key parity: matches the legacy `/inventory?page=N&per_page=20&warehouse_id={id}`
 * URL shape so SWR dedupe holds across consumers.
 *
 * @example
 *   const { data, total, isLoading } =
 *     useWarehouseInventory(warehouseId, page, 20);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { InventoryItem, PaginatedResponse } from '@/types';

export interface UseWarehouseInventoryResult {
  data: InventoryItem[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<InventoryItem> | undefined>;
}

export function useWarehouseInventory(
  warehouseId: string | null | undefined,
  page: number,
  perPage = 20,
): UseWarehouseInventoryResult {
  // URL order matches legacy `[id]/page.tsx`:
  //   `?page=N&per_page=20&warehouse_id={id}` — preserved verbatim for
  //   SWR cache-key parity.
  const key = warehouseId
    ? `/inventory?page=${page}&per_page=${perPage}&warehouse_id=${warehouseId}`
    : null;
  const swr = useSWR<PaginatedResponse<InventoryItem>>(
    key,
    (k: string) => api.get<PaginatedResponse<InventoryItem>>(k),
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
