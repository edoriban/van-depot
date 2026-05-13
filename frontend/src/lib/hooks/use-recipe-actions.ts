/**
 * lib/hooks/use-recipe-actions.ts — typed mutation bundle for the recetas
 * LIST + DETAIL pages.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7 (Migration pattern).
 * Design `sdd/frontend-migration-recetas/design` §4.3 LOCKED — single bundle
 * (mirrors `useWarehouseActions` + `useProductActions`).
 *
 * Each mutation wraps the corresponding `api.post/put/del` and invalidates
 * the relevant SWR cache via `mutate(...)` so consumers re-fetch on next
 * mount (and any active matching key revalidates immediately).
 *
 * **PR-9 (this commit)** ships `createRecipe` + `deleteRecipe` (LIST). The
 * `updateRecipeMeta` + `updateRecipeItems` methods are STUBBED here so the
 * call-site type contract is stable; PR-10 will replace the stubs with real
 * implementations per design §4.3.
 */
'use client';

import { mutate as globalMutate } from 'swr';
import { api } from '@/lib/api-mutations';
import type { Recipe, RecipeDetail, RecipeItemInput } from '@/types';
import type { RecipeFormInput } from '@/features/recetas/schema';

export interface UseRecipeActionsResult {
  createRecipe: (
    input: RecipeFormInput & { items?: RecipeItemInput[] },
  ) => Promise<Recipe>;
  /**
   * STUBBED in PR-9. Replaced with the real PUT `/recipes/{id}` (meta-only)
   * implementation in PR-10. Calling this stub THROWS so accidental PR-9 use
   * fails loudly in development.
   */
  updateRecipeMeta: (
    id: string,
    input: RecipeFormInput,
  ) => Promise<Recipe>;
  /**
   * STUBBED in PR-9. Replaced with the real PUT `/recipes/{id}` (bulk items)
   * implementation in PR-10. Calling this stub THROWS so accidental PR-9 use
   * fails loudly in development.
   */
  updateRecipeItems: (
    id: string,
    input: {
      name: string;
      description: string | null | undefined;
      items: RecipeItemInput[];
    },
  ) => Promise<RecipeDetail>;
  deleteRecipe: (id: string) => Promise<void>;
}

/**
 * Invalidate every active SWR key whose URL starts with the given prefix.
 * Used so paginated list views (e.g. `/recipes?page=2&per_page=20`) all
 * revalidate after a mutation without hardcoding every page index.
 */
function invalidatePrefix(prefix: string): Promise<unknown> {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    undefined,
    { revalidate: true },
  );
}

export function useRecipeActions(): UseRecipeActionsResult {
  return {
    createRecipe: async (input) => {
      const created = await api.post<Recipe>('/recipes', {
        name: input.name,
        description: input.description,
        items: input.items ?? [],
      });
      await invalidatePrefix('/recipes');
      return created;
    },

    updateRecipeMeta: async () => {
      throw new Error(
        'updateRecipeMeta is not yet implemented (PR-10 / frontend-migration-recetas Phase E)',
      );
    },

    updateRecipeItems: async () => {
      throw new Error(
        'updateRecipeItems is not yet implemented (PR-10 / frontend-migration-recetas Phase E)',
      );
    },

    deleteRecipe: async (id) => {
      await api.del<void>(`/recipes/${id}`);
      await invalidatePrefix('/recipes');
    },
  };
}
