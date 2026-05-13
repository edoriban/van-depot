/**
 * components/movements/adjustment-form.tsx — ajuste sub-form.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1.
 *
 * Posts to `/movements/adjustment` with an absolute `new_quantity`. The
 * backend computes the +/- delta against the prior on-hand. Toast copy
 * "Ajuste registrado correctamente" is load-bearing per MOV-INV-5.
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
import { adjustmentSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type { Location, Product, Warehouse } from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface AdjustmentFormProps {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}

export function AdjustmentForm({ products, warehouses, onSuccess }: AdjustmentFormProps) {
  const draft = useMovementsScreenStore((s) => s.adjustment);
  const setField = useMovementsScreenStore((s) => s.setAdjustmentField);
  const resetDraft = useMovementsScreenStore((s) => s.resetAdjustment);
  const [saving, setSaving] = useState(false);

  const { data: locations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = adjustmentSchema.safeParse({
      productId: draft.productId,
      locationId: draft.locationId,
      newQuantity: draft.newQuantity,
      reference: draft.reference,
      notes: draft.notes,
    });
    if (!parsed.success) {
      toast.error('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      await api.post('/movements/adjustment', {
        product_id: parsed.data.productId,
        location_id: parsed.data.locationId,
        new_quantity: parsed.data.newQuantity,
        reference: parsed.data.reference,
        notes: parsed.data.notes,
      });
      toast.success('Ajuste registrado correctamente');
      resetDraft();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar ajuste');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="adjustment-form">
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
        locationId={draft.locationId}
        onLocationChange={(id) => setField('locationId', id)}
        locations={locations}
        label="Ubicacion"
        locationTestId="adjustment-location"
        warehouseTestId="adjustment-warehouse"
      />

      <div className="space-y-2">
        <Label>Nueva cantidad</Label>
        <Input
          type="number"
          min={0}
          step="any"
          value={draft.newQuantity}
          onChange={(e) => setField('newQuantity', e.target.value)}
          required
          placeholder="Nueva cantidad real"
          data-testid="adjustment-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input
          value={draft.reference}
          onChange={(e) => setField('reference', e.target.value)}
          placeholder="Ej: Conteo fisico"
          data-testid="adjustment-reference"
        />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Notas adicionales"
          data-testid="adjustment-notes"
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="adjustment-submit">
        {saving ? 'Registrando...' : 'Registrar ajuste'}
      </Button>
    </form>
  );
}
