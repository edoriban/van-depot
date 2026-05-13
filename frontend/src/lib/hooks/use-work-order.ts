/**
 * lib/hooks/use-work-order.ts — SWR detail hook for a single work order.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR), §6
 * (Convenience-wrapper extraction rule) and `sdd/frontend-migration/design`
 * §3.3 — a typed detail fetch with multiple consumers (the page + the
 * actions hook needs the refresh primitive) warrants a thin wrapper.
 *
 * The cache key is `/work-orders/{id}` so a single mount cycle fans out
 * naturally and mutations can invalidate via `mutate('/work-orders/...')`.
 *
 * @example
 *   const { data, isLoading, error, refresh } = useWorkOrder(id);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { WorkOrderDetail } from '@/types';

export interface UseWorkOrderResult {
  data: WorkOrderDetail | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<WorkOrderDetail | undefined>;
}

export function useWorkOrder(id: string | null | undefined): UseWorkOrderResult {
  const key = id ? `/work-orders/${id}` : null;
  const swr = useSWR<WorkOrderDetail>(key, (k: string) =>
    api.get<WorkOrderDetail>(k),
  );

  const refresh = async () => swr.mutate(undefined, { revalidate: true });

  return {
    data: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
