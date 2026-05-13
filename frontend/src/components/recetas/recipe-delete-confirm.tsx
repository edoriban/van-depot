/**
 * components/recetas/recipe-delete-confirm.tsx — delete-recipe confirmation
 * dialog (LIST page).
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-LIST-INV-5.
 *
 * Reads `deleteTargetRecipe` + `listIsDeleting` from
 * `useRecetasScreenStore`. Calls `useRecipeActions().deleteRecipe` on
 * confirm. Preserves the title `Eliminar receta` + description with the
 * recipe name interpolated. The shared `<ConfirmDialog>` renders the
 * `confirm-delete-btn` testid.
 */
'use client';

import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useRecetasScreenStore } from '@/features/recetas/store';
import { useRecipeActions } from '@/lib/hooks/use-recipe-actions';

interface RecipeDeleteConfirmProps {
  onDeleted: () => void;
}

export function RecipeDeleteConfirm({ onDeleted }: RecipeDeleteConfirmProps) {
  const target = useRecetasScreenStore((s) => s.deleteTargetRecipe);
  const isDeleting = useRecetasScreenStore((s) => s.listIsDeleting);
  const setTarget = useRecetasScreenStore((s) => s.setDeleteTargetRecipe);
  const setDeleting = useRecetasScreenStore((s) => s.setRecipeDeleting);
  const { deleteRecipe } = useRecipeActions();

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteRecipe(target.id);
      setTarget(null);
      onDeleted();
      toast.success('Receta eliminada correctamente');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al eliminar receta';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Eliminar receta"
      description={`Se eliminara la receta "${target?.name}". Esta accion no se puede deshacer.`}
      onConfirm={handleConfirm}
      isLoading={isDeleting}
    />
  );
}
