/**
 * components/movements/entry-with-lot-form.tsx — entry that creates a lot.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1.
 *
 * Posts to `/lots/receive`. The backend resolves the warehouse's "Recepción"
 * location itself — the client sends `warehouse_id`, NOT `location_id` (the
 * selector's locationId is for UI feedback only).
 *
 * On success the response is a discriminated union: `kind: 'lot'` (raw
 * material / consumable+expiry) or `kind: 'direct_inventory'` (tool_spare /
 * consumable no-expiry). Toast copy distinguishes the two.
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { api } from '@/lib/api-mutations';
import { entryWithLotSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type {
  Location,
  Product,
  ReceiveLotResponse,
  Supplier,
  Warehouse,
} from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface EntryWithLotFormProps {
  onSuccess: () => void;
}

export function EntryWithLotForm({ onSuccess }: EntryWithLotFormProps) {
  const draft = useMovementsScreenStore((s) => s.entryWithLot);
  const setField = useMovementsScreenStore((s) => s.setEntryWithLotField);
  const resetDraft = useMovementsScreenStore((s) => s.resetEntryWithLot);
  const [saving, setSaving] = useState(false);

  const { data: products } = useResourceList<Product>('/products');
  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');
  const { data: suppliers } = useResourceList<Supplier>('/suppliers');
  const { data: locations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = entryWithLotSchema.safeParse({
      productId: draft.productId,
      warehouseId: draft.warehouseId,
      lotNumber: draft.lotNumber,
      goodQuantity: draft.goodQuantity,
      defectQuantity: draft.defectQuantity || undefined,
      supplierId: draft.supplierId || undefined,
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
        product_id: parsed.data.productId,
        lot_number: parsed.data.lotNumber,
        warehouse_id: parsed.data.warehouseId,
        good_quantity: parsed.data.goodQuantity,
        defect_quantity: parsed.data.defectQuantity,
        supplier_id: parsed.data.supplierId,
        batch_date: parsed.data.batchDate,
        expiration_date: parsed.data.expirationDate,
        notes: parsed.data.notes,
      });
      if (result.kind === 'lot') {
        toast.success(`Lote ${result.lot.lot_number} recibido correctamente`, {
          description: `Cantidad: ${result.lot.received_quantity}`,
        });
      } else {
        toast.success('Inventario directo creado', {
          description: `Cantidad ${result.quantity} ingresada en Recepción (sin lote).`,
        });
      }
      resetDraft();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al recibir lote');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="entry-lot-form">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Producto</Label>
          <SearchableSelect
            value={draft.productId || undefined}
            onValueChange={(v) => setField('productId', v)}
            options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
            placeholder="Seleccionar producto"
            searchPlaceholder="Buscar producto..."
          />
        </div>
        <div className="space-y-2">
          <Label>Numero de lote</Label>
          <Input
            value={draft.lotNumber}
            onChange={(e) => setField('lotNumber', e.target.value)}
            placeholder="Ej: LOT-2026-001"
            required
            data-testid="lot-number"
          />
        </div>
      </div>

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={draft.warehouseId}
        onWarehouseChange={(id) => setField('warehouseId', id)}
        locationId={draft.locationId}
        onLocationChange={(id) => setField('locationId', id)}
        locations={locations}
        label="Ubicacion destino"
        locationTestId="lot-location"
        warehouseTestId="lot-warehouse"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cantidad buena</Label>
          <Input
            type="number"
            min={0.01}
            step="any"
            value={draft.goodQuantity}
            onChange={(e) => setField('goodQuantity', e.target.value)}
            required
            placeholder="Cantidad en buen estado"
            data-testid="lot-good-qty"
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
            data-testid="lot-defect-qty"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Proveedor (opcional)</Label>
        <SearchableSelect
          value={draft.supplierId || 'none'}
          onValueChange={(v) => setField('supplierId', v === 'none' ? '' : v)}
          options={[
            { value: 'none', label: 'Sin proveedor' },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
          placeholder="Sin proveedor"
          searchPlaceholder="Buscar proveedor..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Fecha de lote (opcional)</Label>
          <Input
            type="date"
            value={draft.batchDate}
            onChange={(e) => setField('batchDate', e.target.value)}
            data-testid="lot-batch-date"
          />
        </div>
        <div className="space-y-2">
          <Label>Fecha de vencimiento (opcional)</Label>
          <Input
            type="date"
            value={draft.expirationDate}
            onChange={(e) => setField('expirationDate', e.target.value)}
            data-testid="lot-expiration-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Observaciones sobre la recepcion"
          rows={3}
          data-testid="lot-notes"
        />
      </div>

      <Button
        type="submit"
        disabled={
          saving || !draft.productId || !draft.lotNumber || !draft.locationId || !draft.goodQuantity
        }
        className="w-full"
        data-testid="lot-submit"
      >
        {saving ? 'Recibiendo...' : 'Recibir lote'}
      </Button>
    </form>
  );
}
