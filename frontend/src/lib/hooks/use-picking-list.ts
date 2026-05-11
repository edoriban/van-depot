/**
 * lib/hooks/use-picking-list.ts — SWR detail hook for `/picking-lists/{id}`.
 *
 * Returns the raw `SWRResponse<PickingListDetailResponse>` so callers (notably
 * `use-picking-actions.ts`) can leverage the full `mutate(data, opts)`
 * overloads for write-through cache updates after a successful transition.
 *
 * Defaults (per locked decision #4 + design §5):
 *   - `refreshInterval: 30_000` (30 s polling).
 *   - `revalidateOnFocus: true` (returning tab MUST catch cross-session transitions).
 *
 * Null/undefined `id` short-circuits to a `null` SWR key — no network call.
 *
 * @example
 *   const { data, error, mutate } = usePickingList(id);
 */
'use client';

import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import { api } from '@/lib/api-mutations';
import type { PickingListDetailResponse } from '@/types';

export function usePickingList(
  id: string | null | undefined,
  swrOptions?: SWRConfiguration<PickingListDetailResponse>,
): SWRResponse<PickingListDetailResponse> {
  const key = id ? `/picking-lists/${id}` : null;
  return useSWR<PickingListDetailResponse>(
    key,
    (url) => api.get<PickingListDetailResponse>(url),
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      ...swrOptions,
    },
  );
}
