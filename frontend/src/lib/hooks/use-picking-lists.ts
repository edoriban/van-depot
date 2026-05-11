/**
 * lib/hooks/use-picking-lists.ts — SWR list hook for `/picking-lists`.
 *
 * Wraps the canonical `useResourceList<PickingListSummary>` primitive with the
 * domain's typed filter interface. The cache key folds query params via
 * `useResourceList::buildKey` so two consumers passing identical defined
 * filters share one network request.
 *
 * Polling: `refreshInterval: 30_000` per locked decision #4 (proposal §5).
 *
 * @example
 *   const { data, isLoading, refresh } = usePickingLists({ status: 'released' });
 */
'use client';

import {
  useResourceList,
  type UseResourceListResult,
} from '@/lib/hooks/use-resource-list';
import type { PickingListStatus, PickingListSummary } from '@/types';

export interface UsePickingListsFilters {
  status?: PickingListStatus;
  warehouse_id?: string;
  assigned_to_user_id?: string;
  page?: number;
  per_page?: number;
}

export function usePickingLists(
  filters: UsePickingListsFilters = {},
): UseResourceListResult<PickingListSummary> {
  // Spread the typed filters into an inline `Record<string, ...>` literal so
  // the index-signature widening matches `useResourceList`'s `query` param
  // signature (TS does NOT auto-widen named interfaces — see #538 deviation 1).
  const query: Record<string, string | number | undefined> = { ...filters };
  return useResourceList<PickingListSummary>('/picking-lists', query, {
    refreshInterval: 30_000,
  });
}
