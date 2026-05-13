/**
 * lib/hooks/use-product.ts — SWR detail hook for a single product.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §7.1
 * (Migration pattern). Mirrors the work-orders precedent
 * (`lib/hooks/use-work-order.ts`).
 *
 * Cache key: `/products/{id}` so the same key invalidated by
 * `useProductActions.updateProduct` / `reclassifyProduct` fans in here for
 * an automatic revalidation (no manual `refresh()` needed in the happy path,
 * but the primitive is exposed for the reclassify dialog flow).
 *
 * @example
 *   const { data: product, isLoading, error, refresh } = useProduct(id);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { Product } from '@/types';

export interface UseProductResult {
  data: Product | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<Product | undefined>;
}

export function useProduct(id: string | null | undefined): UseProductResult {
  const key = id ? `/products/${id}` : null;
  const swr = useSWR<Product>(key, (k: string) => api.get<Product>(k));

  const refresh = async () => swr.mutate(undefined, { revalidate: true });

  return {
    data: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
