/**
 * components/work-orders/work-order-create-dialog.tsx — `Nueva orden` create
 * dialog for the `/ordenes-de-trabajo` page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §3 (SWR), §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Form state lives in `useWorkOrdersScreenStore` (list slice) so the draft
 * survives accidental re-mounts but is cleared on unmount via the FS-2.2
 * cleanup effect mounted by the consuming route. Validation uses
 * `workOrderCreateSchema` per FS-1.1. Backend error codes are mapped to
 * friendly Spanish copy via `CREATE_ERROR_LABELS` (load-bearing for
 * WO-INV-2 — exact copy preserved verbatim from the original page).
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { WorkOrderCreateFormFields } from '@/components/work-orders/work-order-create-form-fields';
import { WorkOrderRecipePreview } from '@/components/work-orders/work-order-recipe-preview';
import { CREATE_ERROR_LABELS } from '@/components/work-orders/work-order-create-error-labels';
import { useWorkOrdersScreenStore } from '@/features/work-orders/store';
import { workOrderCreateSchema } from '@/features/work-orders/schema';
import {
  api,
  createWorkOrder,
  isApiError,
} from '@/lib/api-mutations';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import type {
  Location,
  Product,
  Recipe,
  RecipeDetail,
  Warehouse,
} from '@/types';

interface WorkOrderCreateDialogProps {
  onCreated: () => void;
}

export function WorkOrderCreateDialog({ onCreated }: WorkOrderCreateDialogProps) {
  const formOpen = useWorkOrdersScreenStore((s) => s.formOpen);
  const draft = useWorkOrdersScreenStore((s) => s.draft);
  const setFormField = useWorkOrdersScreenStore((s) => s.setFormField);
  const closeCreateDialog = useWorkOrdersScreenStore(
    (s) => s.closeCreateDialog,
  );

  const [isSaving, setIsSaving] = useState(false);

  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');
  const { data: products } = useResourceList<Product>('/products', {
    is_manufactured: true,
    per_page: 200,
  });
  const { data: recipes } = useResourceList<Recipe>('/recipes', {
    page: 1,
    per_page: 200,
  });
  // Per-warehouse locations for the work-center select. SWR dedups across
  // the filter bar (which also fetches locations for `filterWarehouseId`).
  const { data: formWarehouseLocations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  // SWR-fetch the recipe detail so the BOM preview can show the ingredient
  // list. Null key when no recipe is selected makes SWR inert (no fetch).
  // The fetched detail is consumed directly by `WorkOrderRecipePreview` —
  // the store's `selectedRecipe` slot is reserved for callers (none today)
  // and kept available for PR-4 if the detail page needs cross-component
  // access.
  const recipeDetailKey = draft.recipeId
    ? `/recipes/${draft.recipeId}`
    : null;
  const { data: recipeDetail } = useSWR<RecipeDetail>(
    recipeDetailKey,
    (k: string) => api.get<RecipeDetail>(k),
  );

  const formWorkCenterLocations = draft.warehouseId
    ? formWarehouseLocations.filter((l) => l.location_type === 'work_center')
    : [];

  const canSubmit =
    !!draft.recipeId &&
    !!draft.fgProductId &&
    Number(draft.fgQuantity) > 0 &&
    !!draft.warehouseId &&
    !!draft.workCenterId;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = workOrderCreateSchema.safeParse(draft);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? 'Datos invalidos');
      return;
    }
    setIsSaving(true);
    try {
      const created = await createWorkOrder({
        recipe_id: parsed.data.recipeId,
        fg_product_id: parsed.data.fgProductId,
        fg_quantity: parsed.data.fgQuantity,
        warehouse_id: parsed.data.warehouseId,
        work_center_location_id: parsed.data.workCenterId,
        notes: parsed.data.notes,
      });
      closeCreateDialog();
      toast.success(`Orden ${created.code} creada`);
      onCreated();
    } catch (err) {
      if (isApiError(err) && err.code && CREATE_ERROR_LABELS[err.code]) {
        toast.error(CREATE_ERROR_LABELS[err.code]);
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Error al crear orden',
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={formOpen}
      onOpenChange={(open) => {
        if (!open) closeCreateDialog();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva orden de trabajo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Receta</Label>
            <SearchableSelect
              value={draft.recipeId || undefined}
              onValueChange={(value) => setFormField('recipeId', value)}
              options={recipes.map((r) => ({ value: r.id, label: r.name }))}
              placeholder="Seleccionar receta"
              searchPlaceholder="Buscar receta..."
            />
            <WorkOrderRecipePreview recipe={recipeDetail ?? null} />
          </div>
          <WorkOrderCreateFormFields
            draft={draft}
            products={products}
            warehouses={warehouses}
            workCenterLocations={formWorkCenterLocations}
            setFormField={setFormField}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeCreateDialog}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isSaving}
              data-testid="submit-work-order-btn"
            >
              {isSaving ? 'Creando...' : 'Crear orden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
