/**
 * lib/hooks/use-warehouse-map.ts — thin SWR wrapper for the warehouse map
 * response.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.5 LOCKED — keep the
 * exact `useSWR<WarehouseMapResponse>('/warehouses/{id}/map')` shape from
 * the legacy `[id]/page.tsx` so the SWR cache key (and dedupe) is identical
 * across the refactor (D5 cache-key parity).
 *
 * Unlike the inventory/movements/locations hooks which unwrap a paginated
 * envelope, this hook returns the raw SWR result so the consumer (the
 * Mapa tab) can pass `mapData` straight through to the carved-out
 * `MapCanvas` / `MapSummaryBar` / `ZoneDetail` components.
 *
 * @example
 *   const { data: mapData, isLoading: mapLoading } = useWarehouseMap(id);
 */
'use client';

import useSWR, { type SWRResponse } from 'swr';
import type { WarehouseMapResponse } from '@/types';

export function useWarehouseMap(
  warehouseId: string | null | undefined,
): SWRResponse<WarehouseMapResponse> {
  const key = warehouseId ? `/warehouses/${warehouseId}/map` : null;
  return useSWR<WarehouseMapResponse>(key);
}
