/**
 * components/movements/exit-form.tsx — material salida sub-form.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1.
 *
 * Posts to `/movements/exit` with the original payload shape. Toast copy
 * "Salida registrada correctamente" is load-bearing per MOV-INV-5.
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
import { exitSchema } from '@/features/movements/schema';
import { useMovementsScreenStore } from '@/features/movements/store';
import type { Location, Product, Warehouse } from '@/types';

import { WarehouseLocationSelector } from './warehouse-location-selector';

export interface ExitFormProps {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}

export function ExitForm({ products, warehouses, onSuccess }: ExitFormProps) {
  const draft = useMovementsScreenStore((s) => s.exit);
  const setField = useMovementsScreenStore((s) => s.setExitField);
  const resetDraft = useMovementsScreenStore((s) => s.resetExit);
  const [saving, setSaving] = useState(false);

  const { data: locations } = useResourceList<Location>(
    draft.warehouseId ? `/warehouses/${draft.warehouseId}/locations` : null,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = exitSchema.safeParse({
      productId: draft.productId,
      fromLocationId: draft.fromLocationId,
      quantity: draft.quantity,
      reference: draft.reference,
      notes: draft.notes,
    });
    if (!parsed.success) {
      toast.error('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      await api.post('/movements/exit', {
        product_id: parsed.data.productId,
        from_location_id: parsed.data.fromLocationId,
        quantity: parsed.data.quantity,
        reference: parsed.data.reference,
        notes: parsed.data.notes,
      });
      toast.success('Salida registrada correctamente');
      resetDraft();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="exit-form">
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
        locationId={draft.fromLocationId}
        onLocationChange={(id) => setField('fromLocationId', id)}
        locations={locations}
        label="Ubicacion origen"
        locationTestId="exit-from-location"
        warehouseTestId="exit-warehouse"
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
          data-testid="exit-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input
          value={draft.reference}
          onChange={(e) => setField('reference', e.target.value)}
          placeholder="Ej: Orden de salida #456"
          data-testid="exit-reference"
        />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input
          value={draft.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Notas adicionales"
          data-testid="exit-notes"
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="exit-submit">
        {saving ? 'Registrando...' : 'Registrar salida'}
      </Button>
    </form>
  );
}
