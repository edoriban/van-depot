/**
 * components/recetas/recipe-create-dialog.tsx — Nueva Receta dialog for the
 * `/recetas` LIST page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7 and
 * `sdd/frontend-migration-recetas/spec` REC-LIST-INV-4.
 *
 * Reads `listFormOpen` / `listDraft` / `listIsSaving` from
 * `useRecetasScreenStore` and dispatches `setListFormField`,
 * `closeRecipeDialog`, `setRecipeSaving`. On submit runs
 * `recipeFormSchema.safeParse` then calls
 * `useRecipeActions().createRecipe({ name, description, items: [] })`. On
 * success the page shell resets to page 1 and refreshes via the `onCreated`
 * callback.
 *
 * Preserves verbatim:
 *   - `submit-btn` testid
 *   - `#recipe-name` + `#recipe-description` input ids
 *   - Spanish copy `Nueva Receta` / `Cancelar` / `Crear` / `Creando...`
 *   - `React.FormEvent<HTMLFormElement>` (STRUCT-10 drive-by fix vs. the
 *     legacy `React.SubmitEvent<HTMLFormElement>` typo).
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

interface RecipeCreateDialogProps {
  onCreated: () => void;
}

export function RecipeCreateDialog({ onCreated }: RecipeCreateDialogProps) {
  const formOpen = useRecetasScreenStore((s) => s.listFormOpen);
  const draft = useRecetasScreenStore((s) => s.listDraft);
  const isSaving = useRecetasScreenStore((s) => s.listIsSaving);
  const setField = useRecetasScreenStore((s) => s.setListFormField);
  const closeDialog = useRecetasScreenStore((s) => s.closeRecipeDialog);
  const setSaving = useRecetasScreenStore((s) => s.setRecipeSaving);
  const { createRecipe } = useRecipeActions();
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
      await createRecipe({ ...parsed.data, items: [] });
      closeDialog();
      onCreated();
      toast.success('Receta creada correctamente');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al crear receta';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={formOpen}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Receta</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="recipe-name">Nombre</Label>
            <Input
              id="recipe-name"
              name="name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Nombre de la receta"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-description">Descripcion (opcional)</Label>
            <Textarea
              id="recipe-description"
              name="description"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Descripcion del proyecto o receta"
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
            <Button type="submit" disabled={isSaving} data-testid="submit-btn">
              {isSaving ? 'Creando...' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
