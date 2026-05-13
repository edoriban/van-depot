/**
 * components/movements/entry-form.tsx — simple-entry sub-form.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1 (Migration
 * pattern).
 *
 * Posts to `/movements/entry` with the original payload shape. Toast copy
 * "Entrada registrada correctamente" is load-bearing per MOV-INV-5.
 *
 * `warehouseId` is local-to-the-form for selector control only — it is
 * never sent in the payload; the backend resolves the warehouse from
 * `to_location_id`. This mirrors the pre-refactor handler verbatim.
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { api } from '@/lib/api-mutations';
import { entrySimpleSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type { Location, Product, Supplier, Warehouse } from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface EntryFormProps {
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onSuccess: () => void;
}

export function EntryForm({ products, warehouses, suppliers, onSuccess }: EntryFormProps) {
  const draft = useMovementsScreenStore((s) => s.entrySimple);
  const setField = useMovementsScreenStore((s) => s.setEntrySimpleField);
  const resetDraft = useMovementsScreenStore((s) => s.resetEntrySimple);
  const [saving, setSaving] = useState(false);

  const { data: locations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = entrySimpleSchema.safeParse({
      productId: draft.productId,
      toLocationId: draft.toLocationId,
      quantity: draft.quantity,
      supplierId: draft.supplierId || undefined,
      reference: draft.reference,
      notes: draft.notes,
    });
    if (!parsed.success) {
      toast.error('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      await api.post('/movements/entry', {
        product_id: parsed.data.productId,
        to_location_id: parsed.data.toLocationId,
        quantity: parsed.data.quantity,
        supplier_id: parsed.data.supplierId,
        reference: parsed.data.reference,
        notes: parsed.data.notes,
      });
      toast.success('Entrada registrada correctamente');
      resetDraft();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar entrada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="entry-form">
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

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={draft.warehouseId}
        onWarehouseChange={(id) => setField('warehouseId', id)}
        locationId={draft.toLocationId}
        onLocationChange={(id) => setField('toLocationId', id)}
        locations={locations}
        excludeReception
        label="Ubicacion destino"
        locationHelpText="Para recibir material en Recepción, usa la pestaña 'Con lote' o 'Con orden de compra'."
        locationTestId="entry-to-location"
        warehouseTestId="entry-warehouse"
      />

      <div className="space-y-2">
        <Label>Cantidad</Label>
        <Input
          type="number"
          min={1}
          step="any"
          value={draft.quantity}
          onChange={(e) => setField('quantity', e.target.value)}
          required
          placeholder="Cantidad"
          data-testid="entry-quantity"
        />
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

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input
          value={draft.reference}
          onChange={(e) => setField('reference', e.target.value)}
          placeholder="Ej: Factura #123"
          data-testid="entry-reference"
        />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Notas adicionales"
          data-testid="entry-notes"
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="entry-submit">
        {saving ? 'Registrando...' : 'Registrar entrada'}
      </Button>
    </form>
  );
}
