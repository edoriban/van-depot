/**
 * lib/hooks/use-products.ts — SWR list hook for `/products`.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR), §6
 * (Convenience-wrapper extraction rule) and
 * `sdd/frontend-migration-productos/design` §4.1 — typed filter shapes
 * with 2+ consumers warrant a thin wrapper (mirrors `useWorkOrders`).
 *
 * Cache-key parity: mirrors the URL shape the current page builds inline
 * (`/products?search=...&category_id=...&class=...&is_manufactured=true&page=1&per_page=20`).
 * `page` + `per_page` ALWAYS get serialized — matches today's
 * `?page=${p}&per_page=${perPage}` prefix.
 *
 * Unlike `useResourceList` (which drops the paginated envelope's `total`),
 * this hook preserves it so the consuming list page can drive pagination
 * straight from server-side counts.
 *
 * @example
 *   const { data, total, isLoading, refresh } = useProducts({
 *     page: 1,
 *     per_page: 20,
 *     product_class: 'raw_material',
 *   });
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { PaginatedResponse, Product, ProductClass } from '@/types';

export interface UseProductsFilters {
  search?: string;
  category_id?: string;
  product_class?: ProductClass;
  is_manufactured?: boolean;
  page?: number;
  per_page?: number;
}

export interface UseProductsResult {
  data: Product[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<Product> | undefined>;
}

/**
 * Build the cache key + request URL from the typed filter shape. Matches
 * the inline-`api.get` shape today's `productos/page.tsx` constructs so
 * the SWR cache aligns with any in-flight branches.
 */
function buildKey(filters: UseProductsFilters): string {
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 20;
  let url = `/products?page=${page}&per_page=${perPage}`;
  if (filters.search) {
    url += `&search=${encodeURIComponent(filters.search)}`;
  }
  if (filters.category_id) {
    url += `&category_id=${filters.category_id}`;
  }
  if (filters.product_class) {
    url += `&class=${filters.product_class}`;
  }
  if (filters.is_manufactured) {
    url += `&is_manufactured=true`;
  }
  return url;
}

export function useProducts(
  filters: UseProductsFilters = {},
): UseProductsResult {
  const key = buildKey(filters);
  const swr = useSWR<PaginatedResponse<Product>>(key, (k: string) =>
    api.get<PaginatedResponse<Product>>(k),
  );

  const data = swr.data?.data ?? [];
  const total = swr.data?.total ?? 0;

  const refresh = async () => swr.mutate(undefined, { revalidate: true });

  return {
    data,
    total,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
