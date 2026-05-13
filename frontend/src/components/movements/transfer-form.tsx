/**
 * components/movements/transfer-form.tsx — transferencia sub-form.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1.
 *
 * Posts to `/movements/transfer`. Toast copy "Transferencia registrada
 * correctamente" is load-bearing per MOV-INV-5. The `excludeLocationId`
 * on the destination selector + the `id === toLocationId` clear in
 * onLocationChange together encode the from != to invariant; the Zod
 * `superRefine` in `features/movements/schema.ts` mirrors this server-side.
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
import { transferSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type { Location, Product, Warehouse } from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface TransferFormProps {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}

export function TransferForm({ products, warehouses, onSuccess }: TransferFormProps) {
  const draft = useMovementsScreenStore((s) => s.transfer);
  const setField = useMovementsScreenStore((s) => s.setTransferField);
  const resetDraft = useMovementsScreenStore((s) => s.resetTransfer);
  const [saving, setSaving] = useState(false);

  const { data: fromLocations } = useResourceList<Location>(
    draft.fromWarehouseId ? `/warehouses/${draft.fromWarehouseId}/locations` : null,
  );
  const { data: toLocations } = useResourceList<Location>(
    draft.toWarehouseId ? `/warehouses/${draft.toWarehouseId}/locations` : null,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = transferSchema.safeParse({
      productId: draft.productId,
      fromLocationId: draft.fromLocationId,
      toLocationId: draft.toLocationId,
      quantity: draft.quantity,
      reference: draft.reference,
      notes: draft.notes,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      await api.post('/movements/transfer', {
        product_id: parsed.data.productId,
        from_location_id: parsed.data.fromLocationId,
        to_location_id: parsed.data.toLocationId,
        quantity: parsed.data.quantity,
        reference: parsed.data.reference,
        notes: parsed.data.notes,
      });
      toast.success('Transferencia registrada correctamente');
      resetDraft();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar transferencia');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="transfer-form">
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

      <fieldset className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
        <legend className="px-2 text-sm font-medium text-red-600 dark:text-red-400">Origen</legend>
        <WarehouseLocationSelector
          warehouses={warehouses}
          warehouseId={draft.fromWarehouseId}
          onWarehouseChange={(id) => setField('fromWarehouseId', id)}
          locationId={draft.fromLocationId}
          onLocationChange={(id) => {
            setField('fromLocationId', id);
            if (id === draft.toLocationId) setField('toLocationId', '');
          }}
          locations={fromLocations}
          label="Ubicacion origen"
          locationTestId="transfer-from-location"
          warehouseTestId="transfer-from-warehouse"
        />
      </fieldset>

      <div className="flex items-center justify-center text-2xl text-muted-foreground">
        <span aria-hidden="true">&darr;</span>
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
        <legend className="px-2 text-sm font-medium text-green-600 dark:text-green-400">Destino</legend>
        <WarehouseLocationSelector
          warehouses={warehouses}
          warehouseId={draft.toWarehouseId}
          onWarehouseChange={(id) => setField('toWarehouseId', id)}
          locationId={draft.toLocationId}
          onLocationChange={(id) => setField('toLocationId', id)}
          locations={toLocations}
          excludeLocationId={draft.fromLocationId}
          label="Ubicacion destino"
          locationTestId="transfer-to-location"
          warehouseTestId="transfer-to-warehouse"
        />
      </fieldset>

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
          data-testid="transfer-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input
          value={draft.reference}
          onChange={(e) => setField('reference', e.target.value)}
          placeholder="Ej: Transferencia interna"
          data-testid="transfer-reference"
        />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Notas adicionales"
          data-testid="transfer-notes"
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="transfer-submit">
        {saving ? 'Registrando...' : 'Registrar transferencia'}
      </Button>
    </form>
  );
}
