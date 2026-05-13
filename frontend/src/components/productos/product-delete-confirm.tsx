/**
 * components/productos/product-delete-confirm.tsx — delete-product
 * confirmation dialog (LIST page).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-6.
 *
 * Reads the target product + isDeleting flag from
 * `useProductosScreenStore`. Calls `useProductActions().deleteProduct`
 * on confirm.
 */
'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProductActions } from '@/lib/hooks/use-product-actions';

interface ProductDeleteConfirmProps {
  onDeleted: () => void;
}

export function ProductDeleteConfirm({ onDeleted }: ProductDeleteConfirmProps) {
  const target = useProductosScreenStore((s) => s.deleteTargetProduct);
  const isDeleting = useProductosScreenStore((s) => s.listIsDeleting);
  const setTarget = useProductosScreenStore((s) => s.setDeleteTargetProduct);
  const setDeleting = useProductosScreenStore((s) => s.setProductDeleting);
  const { deleteProduct } = useProductActions();
  const [, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteProduct(target.id);
      setTarget(null);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Eliminar producto"
      description={`Se eliminara el producto "${target?.name}". Esta accion no se puede deshacer.`}
      onConfirm={handleConfirm}
      isLoading={isDeleting}
    />
  );
}
