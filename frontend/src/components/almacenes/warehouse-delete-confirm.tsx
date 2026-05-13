/**
 * components/almacenes/warehouse-delete-confirm.tsx — delete-warehouse
 * confirmation dialog (LIST page).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-6.
 *
 * Reads `deleteTargetWarehouse` + `listIsDeleting` from
 * `useAlmacenesScreenStore`. Calls `useWarehouseActions().deleteWarehouse`
 * on confirm. Preserves the title `Eliminar almacen` + description with the
 * warehouse name interpolated.
 */
'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouseActions } from '@/lib/hooks/use-warehouse-actions';

interface WarehouseDeleteConfirmProps {
  onDeleted: () => void;
  onError: (message: string) => void;
}

export function WarehouseDeleteConfirm({
  onDeleted,
  onError,
}: WarehouseDeleteConfirmProps) {
  const target = useAlmacenesScreenStore((s) => s.deleteTargetWarehouse);
  const isDeleting = useAlmacenesScreenStore((s) => s.listIsDeleting);
  const setTarget = useAlmacenesScreenStore(
    (s) => s.setDeleteTargetWarehouse,
  );
  const setDeleting = useAlmacenesScreenStore((s) => s.setWarehouseDeleting);
  const { deleteWarehouse } = useWarehouseActions();
  const [, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteWarehouse(target.id);
      setTarget(null);
      onDeleted();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar';
      setError(message);
      onError(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Eliminar almacen"
      description={`Se eliminara el almacen "${target?.name}". Esta accion no se puede deshacer.`}
      onConfirm={handleConfirm}
      isLoading={isDeleting}
    />
  );
}
