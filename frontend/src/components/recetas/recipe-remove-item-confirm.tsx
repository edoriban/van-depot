/**
 * components/recetas/recipe-remove-item-confirm.tsx — Quitar material
 * confirmation dialog (DETAIL page).
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-4.
 *
 * Reads `removeTargetItem` from the screen store; on confirm dispatches
 * `removeLocalItem(id)` (which also flips `hasChanges=true`) and clears
 * the target. The shared `<ConfirmDialog>` renders the `confirm-delete-btn`
 * testid (re-used across the codebase).
 */
'use client';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useRecetasScreenStore } from '@/features/recetas/store';

export function RecipeRemoveItemConfirm() {
  const target = useRecetasScreenStore((s) => s.removeTargetItem);
  const setTarget = useRecetasScreenStore((s) => s.setRemoveTargetItem);
  const removeLocalItem = useRecetasScreenStore((s) => s.removeLocalItem);

  const handleConfirm = () => {
    if (!target) return;
    removeLocalItem(target.id);
    setTarget(null);
  };

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Quitar material"
      description={`Se quitara "${target?.product_name}" de la receta.`}
      onConfirm={handleConfirm}
      confirmLabel="Quitar"
    />
  );
}
