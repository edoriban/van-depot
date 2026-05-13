/**
 * lib/hooks/use-location-actions.ts — typed mutation bundle for the
 * Ubicaciones tab (create / update / delete locations).
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-almacenes/design` §4.7 LOCKED — separate
 * bundle from `useWarehouseActions` because the invalidation surface is
 * different (locations cache + map cache, not warehouse cache).
 *
 * Each mutation wraps the corresponding `api.post/put/del` and invalidates:
 *   - `/warehouses/{warehouseId}/locations*` — tree refresh on the page.
 *   - `/warehouses/{warehouseId}/map` — zone structure can change (e.g.
 *     deleting a zone removes it from the map response).
 */
'use client';

import { mutate as globalMutate } from 'swr';
import { api } from '@/lib/api-mutations';
import type { Location } from '@/types';
import type { LocationFormInput } from '@/features/almacenes/schema';

export interface UseLocationActionsResult {
  createLocation: (
    warehouseId: string,
    input: LocationFormInput,
  ) => Promise<Location>;
  updateLocation: (
    id: string,
    input: LocationFormInput,
  ) => Promise<Location>;
  deleteLocation: (id: string) => Promise<void>;
}

function invalidatePrefix(prefix: string): Promise<unknown> {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    undefined,
    { revalidate: true },
  );
}

/**
 * Convert the parsed Zod input into the API payload shape. Matches the
 * legacy `LocationsTab.handleSubmit` body verbatim:
 *   `{ name, location_type, parent_id: parentId || undefined }`.
 */
function buildPayload(input: LocationFormInput): Record<string, unknown> {
  return {
    name: input.name,
    location_type: input.location_type,
    parent_id: input.parent_id,
  };
}

export function useLocationActions(): UseLocationActionsResult {
  return {
    createLocation: async (warehouseId, input) => {
      const created = await api.post<Location>(
        `/warehouses/${warehouseId}/locations`,
        buildPayload(input),
      );
      await Promise.all([
        invalidatePrefix(`/warehouses/${warehouseId}/locations`),
        globalMutate(`/warehouses/${warehouseId}/map`),
      ]);
      return created;
    },
    updateLocation: async (id, input) => {
      const updated = await api.put<Location>(
        `/locations/${id}`,
        buildPayload(input),
      );
      // The location update endpoint doesn't tell us which warehouse it
      // belongs to from the input. Fan out to all warehouse-locations keys
      // so the active page revalidates; the matching map fetch revalidates
      // similarly.
      await Promise.all([
        invalidatePrefix('/warehouses/'),
        invalidatePrefix('/locations'),
      ]);
      return updated;
    },
    deleteLocation: async (id) => {
      await api.del<void>(`/locations/${id}`);
      await Promise.all([
        invalidatePrefix('/warehouses/'),
        invalidatePrefix('/locations'),
      ]);
    },
  };
}
