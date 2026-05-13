/**
 * components/almacenes/warehouse-create-edit-dialog.tsx — Nuevo/Editar
 * almacen dialog for the `/almacenes` LIST page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1 and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-5.
 *
 * Reads the draft + saving flag from `useAlmacenesScreenStore`. On submit
 * runs `warehouseFormSchema.safeParse`, then calls
 * `useWarehouseActions().createWarehouse` (create) or `.updateWarehouse`
 * (edit). On create-success the page resets to page 1 via the `onCreated`
 * callback (matches legacy behavior).
 *
 * Preserves: `submit-btn` testid, the `#warehouse-name` + `#warehouse-address`
 * input ids, and the Spanish copy (`Cancelar` / `Crear` / `Actualizar` /
 * `Guardando...`).
 */
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { warehouseFormSchema } from '@/features/almacenes/schema';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouseActions } from '@/lib/hooks/use-warehouse-actions';

interface WarehouseCreateEditDialogProps {
  onSaved: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}

export function WarehouseCreateEditDialog({
  onSaved,
  onCreated,
  onError,
}: WarehouseCreateEditDialogProps) {
  const formOpen = useAlmacenesScreenStore((s) => s.listFormOpen);
  const editingWarehouse = useAlmacenesScreenStore((s) => s.editingWarehouse);
  const draft = useAlmacenesScreenStore((s) => s.listDraft);
  const isSaving = useAlmacenesScreenStore((s) => s.listIsSaving);
  const setField = useAlmacenesScreenStore((s) => s.setListFormField);
  const closeDialog = useAlmacenesScreenStore((s) => s.closeWarehouseDialog);
  const setSaving = useAlmacenesScreenStore((s) => s.setWarehouseSaving);
  const { createWarehouse, updateWarehouse } = useWarehouseActions();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const parsed = warehouseFormSchema.safeParse({
      name: draft.name,
      address: draft.address,
    });
    if (!parsed.success) {
      setError('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, parsed.data);
      } else {
        await createWarehouse(parsed.data);
      }
      const wasCreate = !editingWarehouse;
      closeDialog();
      onSaved();
      if (wasCreate) onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar';
      setError(message);
      onError(message);
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
            {editingWarehouse ? 'Editar almacen' : 'Nuevo almacen'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="warehouse-name">Nombre</Label>
            <Input
              id="warehouse-name"
              name="name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Nombre del almacen"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="warehouse-address">Direccion</Label>
            <Input
              id="warehouse-address"
              name="address"
              value={draft.address}
              onChange={(e) => setField('address', e.target.value)}
              placeholder="Direccion del almacen (opcional)"
            />
          </div>
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
              {isSaving
                ? 'Guardando...'
                : editingWarehouse
                  ? 'Actualizar'
                  : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
