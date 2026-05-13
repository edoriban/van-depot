/**
 * lib/hooks/use-work-orders.ts — SWR list hook for `/work-orders`.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR), §6
 * (Convenience-wrapper extraction rule) and `sdd/frontend-migration/design`
 * §3.3 — typed filter shapes with 2+ consumers warrant a thin wrapper
 * (mirrors `usePickingLists`).
 *
 * Unlike `useResourceList` (which drops the paginated envelope's `total`),
 * this hook preserves it so the consuming list page can drive pagination
 * straight from server-side counts. Both SWR consumers passing identical
 * defined filters share a single network request via the deterministic
 * cache-key built from the filter object.
 *
 * @example
 *   const { data, total, isLoading, refresh } = useWorkOrders({
 *     status: 'in_progress',
 *     page: 1,
 *     per_page: 20,
 *   });
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type {
  PaginatedResponse,
  WorkOrder,
  WorkOrderStatus,
} from '@/types';

export interface UseWorkOrdersFilters {
  status?: WorkOrderStatus;
  warehouse_id?: string;
  work_center_location_id?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface UseWorkOrdersResult {
  data: WorkOrder[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<WorkOrder> | undefined>;
}

/**
 * Build the canonical cache key + request URL from the typed filter shape.
 * Mirrors `listWorkOrders` so SWR can dedup if a caller hits the same
 * filter combination twice in one mount cycle.
 */
function buildKey(filters: UseWorkOrdersFilters): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.warehouse_id) qs.set('warehouse_id', filters.warehouse_id);
  if (filters.work_center_location_id)
    qs.set('work_center_location_id', filters.work_center_location_id);
  if (filters.search) qs.set('search', filters.search);
  qs.set('page', String(filters.page ?? 1));
  qs.set('per_page', String(filters.per_page ?? 20));
  return `/work-orders?${qs.toString()}`;
}

export function useWorkOrders(
  filters: UseWorkOrdersFilters = {},
): UseWorkOrdersResult {
  const key = buildKey(filters);
  const swr = useSWR<PaginatedResponse<WorkOrder>>(key, (k: string) =>
    api.get<PaginatedResponse<WorkOrder>>(k),
  );

  const data = swr.data?.data ?? [];
  const total = swr.data?.total ?? 0;

  const refresh = async () => {
    return swr.mutate(undefined, { revalidate: true });
  };

  return {
    data,
    total,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
