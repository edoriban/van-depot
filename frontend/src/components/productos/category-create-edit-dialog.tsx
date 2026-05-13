/**
 * components/productos/category-create-edit-dialog.tsx — Nueva/Editar
 * categoria dialog (LIST page Categories tab).
 *
 * See `frontend/src/CONVENTIONS.md` §1, §2, §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-7.
 *
 * Reads the form draft + saving flag from `useProductosScreenStore`. On
 * submit runs `categoryFormSchema.safeParse` and calls
 * `useProductActions().createCategory` (create) or `.updateCategory`
 * (edit). Preserves the `category-name-input` + `submit-btn` testids.
 */
'use client';

import { useState } from 'react';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { categoryFormSchema } from '@/features/productos/schema';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProductActions } from '@/lib/hooks/use-product-actions';
import type { Category } from '@/types';

interface CategoryCreateEditDialogProps {
  allCategories: Category[];
  onSaved: () => void;
}

export function CategoryCreateEditDialog({
  allCategories,
  onSaved,
}: CategoryCreateEditDialogProps) {
  const formOpen = useProductosScreenStore((s) => s.categoriesFormOpen);
  const editingCategory = useProductosScreenStore((s) => s.editingCategory);
  const draft = useProductosScreenStore((s) => s.categoriesDraft);
  const isSaving = useProductosScreenStore((s) => s.categoriesIsSaving);
  const setField = useProductosScreenStore((s) => s.setCategoryFormField);
  const closeDialog = useProductosScreenStore((s) => s.closeCategoryDialog);
  const setSaving = useProductosScreenStore((s) => s.setCategorySaving);
  const { createCategory, updateCategory } = useProductActions();
  const [error, setError] = useState<string | null>(null);

  // Filter out the current category from parent options to prevent cycles.
  const parentOptions = allCategories.filter(
    (c) => c.id !== editingCategory?.id,
  );

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const parsed = categoryFormSchema.safeParse({
        name: draft.name,
        parentId: draft.parentId,
      });
      if (!parsed.success) {
        setError('Revisa los campos del formulario');
        return;
      }
      if (editingCategory) {
        await updateCategory(editingCategory.id, parsed.data);
      } else {
        await createCategory(parsed.data);
      }
      closeDialog();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
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
          <DialogTitle>
            {editingCategory ? 'Editar categoria' : 'Nueva categoria'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="category-name">Nombre</Label>
            <Input
              id="category-name"
              name="name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Nombre de la categoria"
              required
              data-testid="category-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-parent">Categoria padre</Label>
            <SearchableSelect
              value={draft.parentId || 'none'}
              onValueChange={(val) =>
                setField('parentId', val === 'none' ? '' : val)
              }
              options={[
                { value: 'none', label: 'Sin categoria padre' },
                ...parentOptions.map((cat) => ({
                  value: cat.id,
                  label: cat.name,
                })),
              ]}
              placeholder="Sin categoria padre"
              searchPlaceholder="Buscar categoria..."
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
              {isSaving
                ? 'Guardando...'
                : editingCategory
                  ? 'Actualizar'
                  : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
