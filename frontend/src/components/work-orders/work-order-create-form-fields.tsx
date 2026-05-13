/**
 * components/work-orders/work-order-create-form-fields.tsx — the field-set
 * (FG product + quantity + warehouse + work-center + notes) rendered inside
 * the `Nueva orden` create dialog.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Split out of `work-order-create-dialog.tsx` per design §R8 to keep that
 * file under the 270-LOC subcomponent ceiling. Each input is bound to the
 * `useWorkOrdersScreenStore` draft via the parent-provided `setFormField`
 * setter (keeps this component pure — no store access here).
 */
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { WorkOrderCreateDraft } from '@/features/work-orders/store';
import type { Location, Product, Warehouse } from '@/types';

interface WorkOrderCreateFormFieldsProps {
  draft: WorkOrderCreateDraft;
  products: Product[];
  warehouses: Warehouse[];
  workCenterLocations: Location[];
  setFormField: <K extends keyof WorkOrderCreateDraft>(
    key: K,
    value: WorkOrderCreateDraft[K],
  ) => void;
}

export function WorkOrderCreateFormFields({
  draft,
  products,
  warehouses,
  workCenterLocations,
  setFormField,
}: WorkOrderCreateFormFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Producto terminado</Label>
          <SearchableSelect
            value={draft.fgProductId || undefined}
            onValueChange={(value) => setFormField('fgProductId', value)}
            options={products.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.sku})`,
            }))}
            placeholder="Seleccionar FG"
            searchPlaceholder="Buscar producto..."
          />
          {products.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No hay productos marcados como manufacturables. Crea o
              habilita uno en la pagina de Productos.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="fg-quantity">Cantidad</Label>
          <Input
            id="fg-quantity"
            type="number"
            min={0.01}
            step="any"
            value={draft.fgQuantity}
            onChange={(e) => setFormField('fgQuantity', e.target.value)}
            required
            data-testid="fg-quantity-input"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Almacen</Label>
          <SearchableSelect
            value={draft.warehouseId || undefined}
            onValueChange={(value) => {
              setFormField('warehouseId', value);
              // Reset work-center when warehouse changes — the work-center
              // belongs to the warehouse, so the prior selection becomes
              // invalid.
              setFormField('workCenterId', '');
            }}
            options={warehouses.map((w) => ({
              value: w.id,
              label: w.name,
            }))}
            placeholder="Seleccionar almacen"
            searchPlaceholder="Buscar almacen..."
          />
        </div>
        <div className="space-y-2">
          <Label>Centro de trabajo</Label>
          <SearchableSelect
            value={draft.workCenterId || undefined}
            onValueChange={(value) => setFormField('workCenterId', value)}
            options={workCenterLocations.map((l) => ({
              value: l.id,
              label: l.name,
            }))}
            placeholder={
              draft.warehouseId
                ? 'Seleccionar centro'
                : 'Selecciona un almacen primero'
            }
            searchPlaceholder="Buscar centro..."
            disabled={!draft.warehouseId}
          />
          {draft.warehouseId && workCenterLocations.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Este almacen no tiene centros de trabajo. Crea uno antes de
              continuar.
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wo-notes">Notas (opcional)</Label>
        <Textarea
          id="wo-notes"
          value={draft.notes}
          onChange={(e) => setFormField('notes', e.target.value)}
          placeholder="Notas internas para el equipo"
          rows={2}
          data-testid="wo-notes-input"
        />
      </div>
    </>
  );
}
