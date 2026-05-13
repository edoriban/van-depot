/**
 * lib/hooks/use-recipes.ts — paginated SWR wrapper for `/recipes`.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §6
 * (Convenience-wrapper extraction rule); design
 * `sdd/frontend-migration-recetas/design` §4.1.
 *
 * Cache-key parity: matches the URL shape the legacy `/recetas` page built
 * inline (`/recipes?page=N&per_page=20`). SWR dedupe means any in-flight
 * branches reading the same key share the result.
 *
 * @example
 *   const { data, total, isLoading, error, refresh } = useRecipes(page, 20);
 */
'use client';

import useSWR from 'swr';
import type { PaginatedResponse, Recipe } from '@/types';

export interface UseRecipesResult {
  data: Recipe[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<PaginatedResponse<Recipe> | undefined>;
}

export function useRecipes(page: number, perPage = 20): UseRecipesResult {
  const key = `/recipes?page=${page}&per_page=${perPage}`;
  const swr = useSWR<PaginatedResponse<Recipe>>(key);

  const data = swr.data?.data ?? [];
  const total = swr.data?.total ?? 0;

  const refresh = async () =>
    swr.mutate(undefined, { revalidate: true });

  return {
    data,
    total,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
