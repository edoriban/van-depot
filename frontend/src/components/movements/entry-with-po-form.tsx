/**
 * components/movements/entry-with-po-form.tsx — entry-from-PO flow shell.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1.
 *
 * Three-step UX (each step delegated to a sibling component):
 *   1. `<EntryWithPoSearch>` — debounced PO search.
 *   2. `<EntryWithPoLineSelector>` — pick a PO line.
 *   3. `<EntryWithPoReceiptFields>` — fill receipt details + submit.
 *
 * This file orchestrates the three steps and owns the submit handler.
 * `selectedPO` and `poLines` are transient three-step UI state — they live
 * as local `useState` (FS-2.5 step 3), not in the screen store.
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { api } from '@/lib/api-mutations';
import { entryWithPoSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  ReceiveLotResponse,
  Warehouse,
} from '@/types';

import { EntryWithPoLineSelector } from './entry-with-po-line-selector';
import { EntryWithPoReceiptFields } from './entry-with-po-receipt-fields';
import { EntryWithPoSearch } from './entry-with-po-search';

const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  partially_received: 'Parcial',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export interface EntryWithPOFormProps {
  onSuccess: () => void;
}

export function EntryWithPOForm({ onSuccess }: EntryWithPOFormProps) {
  const draft = useMovementsScreenStore((s) => s.entryWithPo);
  const resetDraft = useMovementsScreenStore((s) => s.resetEntryWithPo);

  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');

  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSelectPO = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setSelectedLineId('');
    try {
      const lines = await api.get<PurchaseOrderLine[]>(`/purchase-orders/${po.id}/lines`);
      setPoLines(Array.isArray(lines) ? lines : []);
    } catch {
      toast.error('Error al cargar lineas de la orden');
      setPoLines([]);
    }
  };

  const resetStep2 = () => {
    setSelectedLineId('');
    resetDraft();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPO || !selectedLineId) return;
    const selectedLine = poLines.find((l) => l.id === selectedLineId);
    if (!selectedLine) return;

    const parsed = entryWithPoSchema.safeParse({
      purchaseOrderId: selectedPO.id,
      purchaseOrderLineId: selectedLineId,
      warehouseId: draft.warehouseId,
      lotNumber: draft.lotNumber,
      goodQuantity: draft.goodQuantity,
      defectQuantity: draft.defectQuantity || undefined,
      batchDate: draft.batchDate,
      expirationDate: draft.expirationDate,
      notes: draft.notes,
    });
    if (!parsed.success) {
      toast.error('Revisa los campos del formulario');
      return;
    }

    setSaving(true);
    try {
      const result = await api.post<ReceiveLotResponse>('/lots/receive', {
        product_id: selectedLine.product_id,
        lot_number: parsed.data.lotNumber,
        warehouse_id: parsed.data.warehouseId,
        good_quantity: parsed.data.goodQuantity,
        defect_quantity: parsed.data.defectQuantity,
        supplier_id: selectedPO.supplier_id,
        batch_date: parsed.data.batchDate,
        expiration_date: parsed.data.expirationDate,
        notes: parsed.data.notes,
        purchase_order_line_id: parsed.data.purchaseOrderLineId,
        purchase_order_id: parsed.data.purchaseOrderId,
      });
      if (result.kind === 'lot') {
        toast.success(
          `Material recibido — OC ${selectedPO.order_number} actualizada (Lote: ${result.lot.lot_number})`,
        );
      } else {
        toast.success(
          `Inventario directo creado — OC ${selectedPO.order_number} actualizada`,
          {
            description: `Cantidad ${result.quantity} ingresada en Recepción (sin lote).`,
          },
        );
      }
      resetStep2();
      const updatedLines = await api.get<PurchaseOrderLine[]>(
        `/purchase-orders/${selectedPO.id}/lines`,
      );
      setPoLines(Array.isArray(updatedLines) ? updatedLines : []);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar recepcion');
    } finally {
      setSaving(false);
    }
  };

  const selectedLine = poLines.find((l) => l.id === selectedLineId);
  const pendingQty = selectedLine
    ? selectedLine.quantity_ordered - selectedLine.quantity_received
    : undefined;

  return (
    <div className="space-y-4" data-testid="entry-po-form">
      {!selectedPO && <EntryWithPoSearch onSelect={handleSelectPO} />}

      {selectedPO && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono font-semibold">{selectedPO.order_number}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {selectedPO.supplier_name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {PO_STATUS_LABELS[selectedPO.status] ?? selectedPO.status}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedPO(null);
                    setPoLines([]);
                    resetStep2();
                  }}
                >
                  Cambiar
                </Button>
              </div>
            </div>
          </div>

          <EntryWithPoLineSelector
            lines={poLines}
            selectedLineId={selectedLineId}
            onChange={setSelectedLineId}
          />

          {selectedLineId && (
            <>
              <EntryWithPoReceiptFields warehouses={warehouses} pendingQty={pendingQty} />

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={resetStep2}>
                  Atras
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saving || !draft.locationId || !draft.lotNumber || !draft.goodQuantity
                  }
                  className="flex-1"
                  data-testid="po-submit"
                >
                  {saving ? 'Registrando...' : 'Registrar recepcion'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
