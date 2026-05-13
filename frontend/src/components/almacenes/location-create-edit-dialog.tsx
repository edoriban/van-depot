/**
 * components/almacenes/location-create-edit-dialog.tsx — Nueva/Editar
 * ubicacion dialog (DETAIL page Ubicaciones tab).
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §2 (Zustand), §7.1 and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-4.
 *
 * Carries the type-cascade callback: switching parent re-derives
 * `allowedTypes` from `CHILD_TYPES` and snaps `locationType` to the first
 * allowed value if the current pick is invalid (matches legacy
 * `[id]/page.tsx:625-655`). On submit runs `locationFormSchema.safeParse`
 * then calls `useLocationActions().{create,update}Location`.
 *
 * Preserves: `submit-btn`, `#location-name`, `location-type-select` +
 * `location-parent-select` testids, hierarchy tooltip + description hint,
 * Spanish copy (`Cancelar` / `Crear` / `Actualizar` / `Guardando...`).
 */
'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { locationFormSchema } from '@/features/almacenes/schema';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useLocationActions } from '@/lib/hooks/use-location-actions';
import type { Location, LocationType } from '@/types';
import {
  CHILD_TYPES,
  LOCATION_TYPES_DEFAULT,
  LOCATION_TYPE_DESCRIPTIONS,
  LOCATION_TYPE_LABELS,
} from './location-tree-node';

interface LocationCreateEditDialogProps {
  warehouseId: string;
  allLocations: Location[];
  onError?: (message: string) => void;
}

export function LocationCreateEditDialog({
  warehouseId,
  allLocations,
  onError,
}: LocationCreateEditDialogProps) {
  const formOpen = useAlmacenesScreenStore((s) => s.locationFormOpen);
  const editingLocation = useAlmacenesScreenStore(
    (s) => s.editingLocation,
  );
  const draft = useAlmacenesScreenStore((s) => s.locationDraft);
  const isSaving = useAlmacenesScreenStore((s) => s.locationIsSaving);
  const setField = useAlmacenesScreenStore((s) => s.setLocationFormField);
  const closeDialog = useAlmacenesScreenStore(
    (s) => s.closeLocationDialog,
  );
  const setSaving = useAlmacenesScreenStore((s) => s.setLocationSaving);
  const { createLocation, updateLocation } = useLocationActions();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const parsed = locationFormSchema.safeParse({
      name: draft.name,
      location_type: draft.locationType,
      parent_id: draft.parentId,
    });
    if (!parsed.success) {
      setError('Revisa los campos del formulario');
      return;
    }
    setSaving(true);
    try {
      if (editingLocation) {
        await updateLocation(editingLocation.id, parsed.data);
      } else {
        await createLocation(warehouseId, parsed.data);
      }
      closeDialog();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar';
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Re-derive `allowedTypes` against the selected parent and snap the
   * current `locationType` to the first allowed value if it's no longer
   * valid (matches legacy parent-picker onValueChange).
   */
  const handleParentChange = (val: string) => {
    const newParentId = val === 'none' ? '' : val;
    setField('parentId', newParentId);
    if (newParentId) {
      const parent = allLocations.find((l) => l.id === newParentId);
      if (parent) {
        const allowed = CHILD_TYPES[parent.location_type] ?? [];
        if (allowed.length > 0) {
          setField('allowedTypes', allowed);
          if (!allowed.includes(draft.locationType)) {
            setField('locationType', allowed[0]);
          }
        }
      }
    } else {
      setField('allowedTypes', LOCATION_TYPES_DEFAULT);
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
            {editingLocation ? 'Editar ubicacion' : 'Nueva ubicacion'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="location-name">Nombre</Label>
            <Input
              id="location-name"
              name="name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Nombre de la ubicacion"
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="location-type">Tipo</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  <p className="font-semibold mb-1.5">Jerarquia de ubicaciones:</p>
                  <p>Zona &gt; Rack &gt; Estante &gt; Posicion &gt; Contenedor</p>
                  <p className="mt-1.5 text-muted-foreground">
                    Ejemplo: Zona Refrigerados &gt; Rack A1 &gt; Nivel 2 &gt;
                    Posicion izquierda &gt; Caja 01
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={draft.locationType}
              onValueChange={(val) => setField('locationType', val as LocationType)}
            >
              <SelectTrigger data-testid="location-type-select" className="w-full">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {draft.allowedTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {LOCATION_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.locationType && (
              <p className="text-xs text-muted-foreground">
                {LOCATION_TYPE_DESCRIPTIONS[draft.locationType]}
              </p>
            )}
          </div>
          {!editingLocation && !draft.parentId && (
            <div className="space-y-2">
              <Label htmlFor="location-parent">Ubicacion padre (opcional)</Label>
              <Select value={draft.parentId || 'none'} onValueChange={handleParentChange}>
                <SelectTrigger data-testid="location-parent-select" className="w-full">
                  <SelectValue placeholder="Ninguna" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguna</SelectItem>
                  {allLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} ({LOCATION_TYPE_LABELS[l.location_type]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {draft.parentId && (
            <div className="space-y-2">
              <Label>Ubicacion padre</Label>
              <p className="text-sm text-muted-foreground">
                {allLocations.find((l) => l.id === draft.parentId)?.name ?? 'Seleccionada'}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving} data-testid="submit-btn">
              {isSaving ? 'Guardando...' : editingLocation ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
