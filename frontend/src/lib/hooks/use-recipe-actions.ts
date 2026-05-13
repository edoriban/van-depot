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
 * **PR-9** shipped `createRecipe` + `deleteRecipe` (LIST). **PR-10 (this
 * commit)** replaces the `updateRecipeMeta` + `updateRecipeItems` stubs with
 * real implementations per design §4.3. R8 mitigation: `updateRecipeItems`
 * MUST receive `name + description + items` together so the server PUT does
 * not clobber the meta fields with `undefined`.
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
   * Real PUT `/recipes/{id}` for the edit-meta dialog (DETAIL page).
   * Sends `{ name, description }` only; the backend preserves `items`
   * because they are not part of the payload.
   */
  updateRecipeMeta: (
    id: string,
    input: RecipeFormInput,
  ) => Promise<Recipe>;
  /**
   * Real PUT `/recipes/{id}` for the bulk save-items flow. R8 mitigation:
   * the caller MUST pass the current `name` + `description` alongside the
   * `items` array so the backend does not nullify them.
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

    updateRecipeMeta: async (id, input) => {
      const updated = await api.put<Recipe>(`/recipes/${id}`, {
        name: input.name,
        description: input.description,
      });
      // Invalidate both the paginated list keys AND the detail key.
      await invalidatePrefix('/recipes');
      return updated;
    },

    updateRecipeItems: async (id, input) => {
      const updated = await api.put<RecipeDetail>(`/recipes/${id}`, {
        name: input.name,
        // Preserve the current description verbatim — null and undefined
        // both serialize as omitted via JSON.stringify, matching the legacy
        // `description: detail?.recipe.description` shape.
        description: input.description ?? undefined,
        items: input.items,
      });
      await invalidatePrefix('/recipes');
      return updated;
    },

    deleteRecipe: async (id) => {
      await api.del<void>(`/recipes/${id}`);
      await invalidatePrefix('/recipes');
    },
  };
}
