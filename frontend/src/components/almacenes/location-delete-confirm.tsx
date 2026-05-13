/**
 * components/almacenes/location-delete-confirm.tsx — delete-location
 * confirmation dialog (DETAIL page Ubicaciones tab).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-5.
 *
 * Reads `deleteTargetLocation` + `locationIsDeleting` from
 * `useAlmacenesScreenStore`. Calls `useLocationActions().deleteLocation` on
 * confirm. Preserves the title `Eliminar ubicacion` + description with the
 * location name interpolated (matches legacy verbatim).
 */
'use client';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useLocationActions } from '@/lib/hooks/use-location-actions';

interface LocationDeleteConfirmProps {
  onError?: (message: string) => void;
}

export function LocationDeleteConfirm({
  onError,
}: LocationDeleteConfirmProps) {
  const target = useAlmacenesScreenStore((s) => s.deleteTargetLocation);
  const isDeleting = useAlmacenesScreenStore((s) => s.locationIsDeleting);
  const setTarget = useAlmacenesScreenStore(
    (s) => s.setDeleteTargetLocation,
  );
  const setDeleting = useAlmacenesScreenStore(
    (s) => s.setLocationDeleting,
  );
  const { deleteLocation } = useLocationActions();

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteLocation(target.id);
      setTarget(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al eliminar';
      onError?.(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Eliminar ubicacion"
      description={`Se eliminara la ubicacion "${target?.name}". Esta accion no se puede deshacer.`}
      onConfirm={handleConfirm}
      isLoading={isDeleting}
    />
  );
}
