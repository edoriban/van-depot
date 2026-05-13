/**
 * lib/hooks/use-recipe.ts — SWR detail hook for a single recipe.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §7
 * (Migration pattern); design `sdd/frontend-migration-recetas/design` §4.2.
 *
 * Cache key: `/recipes/{id}` so the same key invalidated by
 * `useRecipeActions.updateRecipeMeta` / `updateRecipeItems` fans in here for
 * an automatic revalidation. Null-key inert pattern: passing `null` (or an
 * empty string) makes the hook a no-op (no fetch, no state) — useful while
 * the route is resolving the `useParams` value.
 *
 * @example
 *   const { detail, isLoading, error, refresh } = useRecipe(recipeId);
 */
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-mutations';
import type { RecipeDetail } from '@/types';

export interface UseRecipeResult {
  detail: RecipeDetail | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<RecipeDetail | undefined>;
}

export function useRecipe(id: string | null | undefined): UseRecipeResult {
  const key = id ? `/recipes/${id}` : null;
  const swr = useSWR<RecipeDetail>(key, (k: string) =>
    api.get<RecipeDetail>(k),
  );

  const refresh = async () => swr.mutate(undefined, { revalidate: true });

  return {
    detail: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    refresh,
  };
}
