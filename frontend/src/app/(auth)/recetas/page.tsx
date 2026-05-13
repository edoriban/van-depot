/**
 * app/(auth)/recetas/page.tsx — thin orchestration shell for the
 * `/recetas` LIST screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7 (Migration
 * pattern) and `sdd/frontend-migration-recetas/design` §2.1.
 *
 * State assignment:
 * - SERVER-OWNED (`/recipes`) → `useRecipes` SWR wrapper.
 * - URL-SHAREABLE → NONE on this page; recetas has no `useSearchParams`
 *   today (STRUCT-7 preserves that property).
 * - CROSS-COMPONENT screen state → `useRecetasScreenStore` (LIST slice:
 *   page cursor, dialog flag, form draft, delete target).
 * - HYPER-LOCAL UI → small local `useState` for the error banner only.
 *
 * The LIST slice of `useRecetasScreenStore` is cleared on unmount via the
 * FS-2.2 cleanup effect. The DETAIL slice cleanup will be wired in PR-10
 * (`recetas/[id]/page.tsx`).
 */
'use client';

import { useEffect } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { TaskDaily01Icon } from '@hugeicons/core-free-icons';
import { RecipeCreateDialog } from '@/components/recetas/recipe-create-dialog';
import { RecipeDeleteConfirm } from '@/components/recetas/recipe-delete-confirm';
import { RecipeGrid } from '@/components/recetas/recipe-grid';
import { PageTransition } from '@/components/shared/page-transition';
import { Button } from '@/components/ui/button';
import { useRecetasScreenStore } from '@/features/recetas/store';
import { useRecipes } from '@/lib/hooks/use-recipes';

const PER_PAGE = 20;

export default function RecetasPage() {
  const listPage = useRecetasScreenStore((s) => s.listPage);
  const setListPage = useRecetasScreenStore((s) => s.setListPage);
  const openCreateRecipe = useRecetasScreenStore((s) => s.openCreateRecipe);
  const setDeleteTargetRecipe = useRecetasScreenStore(
    (s) => s.setDeleteTargetRecipe,
  );

  const { data: recipes, total, isLoading, error: fetchError, refresh } =
    useRecipes(listPage, PER_PAGE);

  // FS-2.2 — reset the LIST slice when the page unmounts.
  useEffect(
    () => () => useRecetasScreenStore.getState().resetList(),
    [],
  );

  // Derive the banner message directly from the SWR error — no extra
  // useState needed. Matches the pre-refactor `setError(err.message)` shape
  // inside the legacy `fetchRecipes`, and avoids the set-state-in-effect
  // anti-pattern flagged by `react-hooks/set-state-in-effect`.
  const error: string | null = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'Error al cargar recetas'
    : null;

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <PageTransition>
      <div className="space-y-6" data-testid="recetas-page">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HugeiconsIcon
              icon={TaskDaily01Icon}
              size={28}
              className="text-primary"
            />
            <div>
              <h1 className="text-2xl font-semibold">Recetas de Proyecto</h1>
              <p className="text-muted-foreground mt-1">
                Gestiona las listas de materiales para tus proyectos
              </p>
            </div>
          </div>
          <Button onClick={openCreateRecipe} data-testid="new-recipe-btn">
            Nueva Receta
          </Button>
        </div>

        {error && (
          <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <RecipeGrid
          recipes={recipes}
          isLoading={isLoading}
          onCreate={openCreateRecipe}
          onDelete={setDeleteTargetRecipe}
        />

        {totalPages > 1 && (
          <div
            className="flex items-center justify-center gap-2"
            data-testid="pagination"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setListPage(Math.max(1, listPage - 1))}
              disabled={listPage <= 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {listPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setListPage(Math.min(totalPages, listPage + 1))
              }
              disabled={listPage >= totalPages}
            >
              Siguiente
            </Button>
          </div>
        )}

        <RecipeCreateDialog
          onCreated={() => {
            // Match legacy: after creating, jump back to page 1 so the new
            // recipe is visible at the top of the list.
            setListPage(1);
            void refresh();
          }}
        />

        <RecipeDeleteConfirm
          onDeleted={() => {
            void refresh();
          }}
        />
      </div>
    </PageTransition>
  );
}
