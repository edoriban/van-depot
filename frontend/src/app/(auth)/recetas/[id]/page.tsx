/**
 * app/(auth)/recetas/[id]/page.tsx — thin orchestration shell for the
 * `/recetas/[id]` DETAIL screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7 (Migration
 * pattern) and `sdd/frontend-migration-recetas/design` §2.2 + §5.
 *
 * State assignment:
 * - SERVER-OWNED (`/recipes/{id}`) → `useRecipe` SWR wrapper.
 * - URL-SHAREABLE → NONE on this page; recetas has no `useSearchParams`
 *   today (STRUCT-7 preserves that property).
 * - CROSS-COMPONENT screen state → `useRecetasScreenStore` (DETAIL slice:
 *   localItems, hasChanges, edit/add-item drafts, remove target, dispatch
 *   flag, spinners).
 * - HYPER-LOCAL UI → none.
 *
 * The DETAIL slice cleanup mounts via FS-2.2 — the LIST slice survives so a
 * back navigation preserves the list page's pagination + open dialogs.
 *
 * Local-items unsaved-changes pattern (design §5 LOCKED):
 *   `loadDetail(detail)` is the SOLE entry point that seeds / clobbers
 *   `localItems` from the server response. The page shell dispatches it on
 *   every SWR success.
 */
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { RecipeAddItemDialog } from '@/components/recetas/recipe-add-item-dialog';
import { RecipeDetailHeader } from '@/components/recetas/recipe-detail-header';
import { RecipeDetailToolbar } from '@/components/recetas/recipe-detail-toolbar';
import { RecipeEditDialog } from '@/components/recetas/recipe-edit-dialog';
import { RecipeItemsTable } from '@/components/recetas/recipe-items-table';
import { RecipeRemoveItemConfirm } from '@/components/recetas/recipe-remove-item-confirm';
import { DispatchWizard } from '@/components/recipes/dispatch-wizard';
import { Button } from '@/components/ui/button';
import { useRecetasScreenStore } from '@/features/recetas/store';
import { useRecipe } from '@/lib/hooks/use-recipe';

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const recipeId = params.id;

  // FS-2.2 — reset the DETAIL slice when the page unmounts. The LIST slice
  // survives so back-navigation preserves list pagination.
  useEffect(
    () => () => useRecetasScreenStore.getState().resetDetail(),
    [],
  );

  const setDetailRecipeId = useRecetasScreenStore(
    (s) => s.setDetailRecipeId,
  );
  const loadDetail = useRecetasScreenStore((s) => s.loadDetail);
  const localItems = useRecetasScreenStore((s) => s.localItems);
  const hasChanges = useRecetasScreenStore((s) => s.hasChanges);
  const isSaving = useRecetasScreenStore((s) => s.detailIsSaving);
  const openEditRecipeDialog = useRecetasScreenStore(
    (s) => s.openEditRecipeDialog,
  );
  const openAddItemDialog = useRecetasScreenStore(
    (s) => s.openAddItemDialog,
  );
  const setRemoveTargetItem = useRecetasScreenStore(
    (s) => s.setRemoveTargetItem,
  );
  const dispatchWizardOpen = useRecetasScreenStore(
    (s) => s.dispatchWizardOpen,
  );
  const setDispatchWizardOpen = useRecetasScreenStore(
    (s) => s.setDispatchWizardOpen,
  );

  const { detail, isLoading, error, refresh } = useRecipe(recipeId);

  // Track the mounted id so a back-then-forward across recipes resets the
  // local-items draft (R1 mitigation — handled by the store action when the
  // id changes).
  useEffect(() => {
    setDetailRecipeId(recipeId ?? null);
  }, [recipeId, setDetailRecipeId]);

  // Seed localItems from the server on every SWR success (design §5.2).
  useEffect(() => {
    if (detail) {
      loadDetail(detail);
    }
  }, [detail, loadDetail]);

  if (isLoading && !detail) {
    return (
      <div className="space-y-6" data-testid="recipe-detail-loading">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    const message =
      error instanceof Error ? error.message : 'No se pudo cargar la receta solicitada.';
    return (
      <div className="space-y-6" data-testid="recipe-detail-error">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/recetas" data-testid="back-to-recipes">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Receta no encontrada</h1>
        </div>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {message}
        </div>
      </div>
    );
  }

  const { recipe } = detail;

  return (
    <div className="space-y-6" data-testid="recipe-detail-page">
      <RecipeDetailHeader
        recipe={recipe}
        onEdit={() => openEditRecipeDialog(recipe)}
      />

      <RecipeDetailToolbar
        recipeId={recipeId}
        recipe={recipe}
        localItems={localItems}
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSavedRefresh={() => {
          void refresh();
        }}
      />

      <RecipeItemsTable
        localItems={localItems}
        hasChanges={hasChanges}
        onCreate={openAddItemDialog}
        onRemove={setRemoveTargetItem}
      />

      <RecipeEditDialog
        recipeId={recipeId}
        onUpdatedRefresh={() => {
          void refresh();
        }}
      />

      <RecipeAddItemDialog />

      <RecipeRemoveItemConfirm />

      <DispatchWizard
        recipeId={recipeId}
        recipeName={recipe.name}
        open={dispatchWizardOpen}
        onOpenChange={setDispatchWizardOpen}
        onDispatchComplete={() => {
          void refresh();
        }}
      />
    </div>
  );
}
