/**
 * components/recetas/recipe-detail-toolbar.tsx — 3-button action bar on the
 * `/recetas/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-3 + REC-DETAIL-INV-5
 * + REC-DETAIL-INV-6.
 *
 * Buttons:
 *   - `add-item-btn` (always visible) — dispatches `openAddItemDialog`.
 *   - `save-items-btn` (gated on `hasChanges`) — sends the bulk
 *     PUT `/recipes/{id}` with `name + description + items` per R8.
 *   - `dispatch-wizard-btn` (disabled when `localItems.length === 0`) —
 *     toggles `dispatchWizardOpen=true` so the page-shell-mounted
 *     `<DispatchWizard />` opens.
 */
'use client';

import { toast } from 'sonner';
import { Add01Icon, TaskDaily01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import { useRecetasScreenStore } from '@/features/recetas/store';
import { useRecipeActions } from '@/lib/hooks/use-recipe-actions';
import type { Recipe, RecipeItem, RecipeItemInput } from '@/types';

interface RecipeDetailToolbarProps {
  recipeId: string;
  recipe: Recipe;
  localItems: RecipeItem[];
  hasChanges: boolean;
  isSaving: boolean;
  onSavedRefresh: () => void;
}

export function RecipeDetailToolbar({
  recipeId,
  recipe,
  localItems,
  hasChanges,
  isSaving,
  onSavedRefresh,
}: RecipeDetailToolbarProps) {
  const openAddItemDialog = useRecetasScreenStore(
    (s) => s.openAddItemDialog,
  );
  const setDetailSaving = useRecetasScreenStore((s) => s.setDetailSaving);
  const setDispatchWizardOpen = useRecetasScreenStore(
    (s) => s.setDispatchWizardOpen,
  );
  const { updateRecipeItems } = useRecipeActions();

  const handleSave = async () => {
    setDetailSaving(true);
    try {
      const items: RecipeItemInput[] = localItems.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        notes: item.notes ?? undefined,
      }));
      await updateRecipeItems(recipeId, {
        name: recipe.name,
        description: recipe.description,
        items,
      });
      onSavedRefresh();
      toast.success('Materiales guardados correctamente');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al guardar materiales',
      );
    } finally {
      setDetailSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={openAddItemDialog} data-testid="add-item-btn">
        <HugeiconsIcon icon={Add01Icon} size={16} className="mr-2" />
        Agregar Material
      </Button>
      {hasChanges && (
        <Button
          variant="default"
          onClick={handleSave}
          disabled={isSaving}
          data-testid="save-items-btn"
        >
          {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => setDispatchWizardOpen(true)}
        disabled={localItems.length === 0}
        data-testid="dispatch-wizard-btn"
      >
        <HugeiconsIcon icon={TaskDaily01Icon} size={16} className="mr-2" />
        Despachar receta
      </Button>
    </div>
  );
}
