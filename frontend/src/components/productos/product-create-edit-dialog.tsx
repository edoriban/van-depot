/**
 * components/productos/product-create-edit-dialog.tsx — Nuevo/Editar
 * producto dialog (LIST page) — thin shell wrapping `<ProductFormFields>`.
 *
 * See `frontend/src/CONVENTIONS.md` §1, §2, §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-5.
 *
 * Reads the form draft + saving flag from `useProductosScreenStore`. On
 * submit runs `productCreateSchema.safeParse` (create) or
 * `productEditSchema.safeParse` (edit), then calls the corresponding
 * `useProductActions` mutation. Errors surface as Spanish toasts or the
 * inline banner per current behavior.
 *
 * The actual field grid lives in `<ProductFormFields>` (split per design
 * §7 R8 LOC-budget rule, mirrors the work-orders dialog split).
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
import {
  productCreateSchema,
  productEditSchema,
} from '@/features/productos/schema';
import { useProductosScreenStore } from '@/features/productos/store';
import { isApiError } from '@/lib/api-mutations';
import { useProductActions } from '@/lib/hooks/use-product-actions';
import type { Category } from '@/types';
import { ProductFormFields } from './product-form-fields';

interface ProductCreateEditDialogProps {
  categories: Category[];
  onSaved: () => void;
}

export function ProductCreateEditDialog({
  categories,
  onSaved,
}: ProductCreateEditDialogProps) {
  const formOpen = useProductosScreenStore((s) => s.listFormOpen);
  const editingProduct = useProductosScreenStore((s) => s.editingProduct);
  const draft = useProductosScreenStore((s) => s.listDraft);
  const isSaving = useProductosScreenStore((s) => s.listIsSaving);
  const setField = useProductosScreenStore((s) => s.setListFormField);
  const closeDialog = useProductosScreenStore((s) => s.closeProductDialog);
  const setSaving = useProductosScreenStore((s) => s.setProductSaving);
  const { createProduct, updateProduct } = useProductActions();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editingProduct) {
        const parsed = productEditSchema.safeParse({
          name: draft.name,
          sku: draft.sku,
          description: draft.description,
          categoryId: draft.categoryId,
          unit: draft.unit,
          hasExpiry: draft.hasExpiry,
          minStock: draft.minStock,
          maxStock: draft.maxStock,
          isActive: editingProduct.is_active,
        });
        if (!parsed.success) {
          setError('Revisa los campos del formulario');
          return;
        }
        await updateProduct(editingProduct.id, parsed.data);
      } else {
        const parsed = productCreateSchema.safeParse({
          name: draft.name,
          sku: draft.sku,
          description: draft.description,
          categoryId: draft.categoryId,
          unit: draft.unit,
          productClass: draft.productClass,
          hasExpiry: draft.hasExpiry,
          isManufactured: draft.isManufactured,
          minStock: draft.minStock,
          maxStock: draft.maxStock,
        });
        if (!parsed.success) {
          setError('Revisa los campos del formulario');
          return;
        }
        await createProduct(parsed.data);
      }
      closeDialog();
      onSaved();
    } catch (err) {
      if (
        isApiError(err) &&
        err.code === 'PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL'
      ) {
        toast.error(
          "No se puede marcar este producto como manufacturable porque su clase no es 'Materia prima'.",
        );
      } else {
        setError(err instanceof Error ? err.message : 'Error al guardar');
      }
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
            {editingProduct ? 'Editar producto' : 'Nuevo producto'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <ProductFormFields
            draft={draft}
            editingProduct={editingProduct}
            categories={categories}
            setField={setField}
          />
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
              {isSaving ? 'Guardando...' : editingProduct ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
