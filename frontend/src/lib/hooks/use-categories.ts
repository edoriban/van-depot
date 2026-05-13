/**
 * lib/hooks/use-categories.ts — SWR list hook for `/categories`.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and
 * `sdd/frontend-migration-productos/design` §4.2.
 *
 * Multiple consumers (productos LIST filter dropdown + lookup map, the
 * categories tab parent picker + tree, product DETAIL page edit form in
 * PR-6) share the same `/categories?page=1&per_page=100` default key so
 * SWR dedupes the network call.
 *
 * @example
 *   const { data: allCategories } = useCategories();
 *   const { data: pagedCategories, total } = useCategories({ page, per_page: 20 });
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { Category, PaginatedResponse } from '@/types';

export interface UseCategoriesFilters {
  page?: number;
  per_page?: number;
}

export interface UseCategoriesResult {
  data: Category[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<Category> | undefined>;
}

const DEFAULT_FILTERS: UseCategoriesFilters = { page: 1, per_page: 100 };

function buildKey(filters: UseCategoriesFilters): string {
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 100;
  return `/categories?page=${page}&per_page=${perPage}`;
}

export function useCategories(
  filters: UseCategoriesFilters = DEFAULT_FILTERS,
): UseCategoriesResult {
  const key = buildKey(filters);
  const swr = useSWR<PaginatedResponse<Category>>(key, (k: string) =>
    api.get<PaginatedResponse<Category>>(k),
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
