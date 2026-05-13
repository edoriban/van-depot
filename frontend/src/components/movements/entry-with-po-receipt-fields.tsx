/**
 * components/movements/entry-with-po-receipt-fields.tsx — step-3 input
 * fields (warehouse + location + lot + qty + dates + notes) for the
 * entry-with-PO flow.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Reads + writes the `entryWithPo` draft from `useMovementsScreenStore`.
 * The submit button is owned by the parent so we keep this strictly
 * presentational.
 */
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { useMovementsScreenStore } from '@/features/movements/store';
import type { Location, Warehouse } from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface EntryWithPoReceiptFieldsProps {
  warehouses: Warehouse[];
  pendingQty: number | undefined;
}

export function EntryWithPoReceiptFields({ warehouses, pendingQty }: EntryWithPoReceiptFieldsProps) {
  const draft = useMovementsScreenStore((s) => s.entryWithPo);
  const setField = useMovementsScreenStore((s) => s.setEntryWithPoField);

  const { data: locations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  return (
    <>
      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={draft.warehouseId}
        onWarehouseChange={(id) => setField('warehouseId', id)}
        locationId={draft.locationId}
        onLocationChange={(id) => setField('locationId', id)}
        locations={locations}
        label="Ubicacion destino"
        locationTestId="po-location"
        warehouseTestId="po-warehouse"
      />

      <div className="space-y-2">
        <Label>Numero de lote</Label>
        <Input
          value={draft.lotNumber}
          onChange={(e) => setField('lotNumber', e.target.value)}
          placeholder="Ej: LOT-2026-001"
          required
          data-testid="po-lot-number"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>
            Cantidad a recibir
            {pendingQty !== undefined && (
              <span className="ml-1 text-xs text-muted-foreground">
                (max sugerido: {pendingQty.toFixed(2)})
              </span>
            )}
          </Label>
          <Input
            type="number"
            min={0.01}
            max={pendingQty}
            step="any"
            value={draft.goodQuantity}
            onChange={(e) => setField('goodQuantity', e.target.value)}
            required
            placeholder="Cantidad en buen estado"
            data-testid="po-good-qty"
          />
        </div>
        <div className="space-y-2">
          <Label>Cantidad defectuosa (opcional)</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={draft.defectQuantity}
            onChange={(e) => setField('defectQuantity', e.target.value)}
            placeholder="0"
            data-testid="po-defect-qty"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Fecha de lote (opcional)</Label>
          <Input
            type="date"
            value={draft.batchDate}
            onChange={(e) => setField('batchDate', e.target.value)}
            data-testid="po-batch-date"
          />
        </div>
        <div className="space-y-2">
          <Label>Fecha de vencimiento (opcional)</Label>
          <Input
            type="date"
            value={draft.expirationDate}
            onChange={(e) => setField('expirationDate', e.target.value)}
            data-testid="po-expiration-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Observaciones sobre la recepcion"
          rows={2}
          data-testid="po-notes"
        />
      </div>
    </>
  );
}
