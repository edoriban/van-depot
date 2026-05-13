/**
 * lib/hooks/use-product-class-lock.ts — non-blocking SWR probe for the
 * product class-lock status surfaced by the reclassify dialog.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR), §7.1
 * (Migration pattern) and `sdd/frontend-migration-productos/design` §4.4 +
 * spec PROD-DETAIL-INV-5.
 *
 * The probe is intentionally non-blocking: if the request throws the hook
 * returns `lock: null` and lets the reclassify CTA stay enabled. The actual
 * reclassify call still surfaces a 409 if the backend reports the product
 * is locked.
 *
 * `refetch()` is exposed so the reclassify dialog can refresh the counts
 * when the dialog opens AND when a successful reclassify lands.
 *
 * @example
 *   const { lock, isLoading, refetch } = useProductClassLock(id);
 */
'use client';

import useSWR from 'swr';
import { getProductClassLock } from '@/lib/api-mutations';
import type { ClassLockStatus } from '@/types';

export interface UseProductClassLockResult {
  lock: ClassLockStatus | null;
  isLoading: boolean;
  refetch: () => Promise<ClassLockStatus | null | undefined>;
}

export function useProductClassLock(
  id: string | null | undefined,
): UseProductClassLockResult {
  const key = id ? `/products/${id}/class-lock` : null;
  const swr = useSWR<ClassLockStatus | null>(
    key,
    async () => {
      if (!id) return null;
      try {
        return await getProductClassLock(id);
      } catch {
        // Non-blocking — fall back to enabled UI per PROD-DETAIL-INV-5. The
        // reclassify mutation still surfaces a 409 if the backend rejects.
        return null;
      }
    },
  );

  const refetch = async () => swr.mutate(undefined, { revalidate: true });

  return {
    lock: swr.data ?? null,
    isLoading: swr.isLoading,
    refetch,
  };
}
