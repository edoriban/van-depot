/**
 * components/recetas/recipe-edit-dialog.tsx — Editar Receta dialog on the
 * `/recetas/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7 and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-2.
 *
 * Reads `editOpen` / `editDraft` / `detailIsSaving` from the screen store
 * and dispatches `setEditField`, `closeEditRecipeDialog`, `setDetailSaving`.
 * On submit runs `recipeFormSchema.safeParse` then calls
 * `useRecipeActions().updateRecipeMeta(recipeId, ...)`. On success the page
 * shell refreshes via `props.onUpdatedRefresh`.
 *
 * Preserves verbatim:
 *   - `edit-submit-btn` testid
 *   - `#edit-recipe-name` + `#edit-recipe-desc` input ids
 *   - Spanish copy `Editar Receta` / `Cancelar` / `Actualizar` / `Guardando...`
 *   - `React.FormEvent<HTMLFormElement>` (STRUCT-10 — fixes the legacy
 *     `SubmitEvent<HTMLFormElement>` typo).
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { recipeFormSchema } from '@/features/recetas/schema';
import { useRecetasScreenStore } from '@/features/recetas/store';
import { useRecipeActions } from '@/lib/hooks/use-recipe-actions';

interface RecipeEditDialogProps {
  recipeId: string;
  onUpdatedRefresh: () => void;
}

export function RecipeEditDialog({
  recipeId,
  onUpdatedRefresh,
}: RecipeEditDialogProps) {
  const open = useRecetasScreenStore((s) => s.editOpen);
  const draft = useRecetasScreenStore((s) => s.editDraft);
  const isSaving = useRecetasScreenStore((s) => s.detailIsSaving);
  const setField = useRecetasScreenStore((s) => s.setEditField);
  const closeDialog = useRecetasScreenStore((s) => s.closeEditRecipeDialog);
  const setSaving = useRecetasScreenStore((s) => s.setDetailSaving);
  const { updateRecipeMeta } = useRecipeActions();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const parsed = recipeFormSchema.safeParse({
      name: draft.name,
      description: draft.description,
    });
    if (!parsed.success) {
      setError('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      await updateRecipeMeta(recipeId, parsed.data);
      closeDialog();
      onUpdatedRefresh();
      toast.success('Receta actualizada');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al actualizar';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Receta</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-recipe-name">Nombre</Label>
            <Input
              id="edit-recipe-name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Nombre de la receta"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-recipe-desc">Descripcion (opcional)</Label>
            <Textarea
              id="edit-recipe-desc"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Descripcion del proyecto"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              data-testid="edit-submit-btn"
            >
              {isSaving ? 'Guardando...' : 'Actualizar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
