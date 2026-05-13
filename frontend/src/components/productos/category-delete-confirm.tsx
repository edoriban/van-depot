/**
 * components/productos/category-delete-confirm.tsx — delete-category
 * confirmation dialog (LIST page Categories tab).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-7.
 *
 * Reads the target category + isDeleting flag from
 * `useProductosScreenStore`. Calls `useProductActions().deleteCategory`
 * on confirm.
 */
'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProductActions } from '@/lib/hooks/use-product-actions';

interface CategoryDeleteConfirmProps {
  onDeleted: () => void;
}

export function CategoryDeleteConfirm({
  onDeleted,
}: CategoryDeleteConfirmProps) {
  const target = useProductosScreenStore((s) => s.deleteTargetCategory);
  const isDeleting = useProductosScreenStore((s) => s.categoriesIsDeleting);
  const setTarget = useProductosScreenStore((s) => s.setDeleteTargetCategory);
  const setDeleting = useProductosScreenStore((s) => s.setCategoryDeleting);
  const { deleteCategory } = useProductActions();
  const [, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteCategory(target.id);
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
      title="Eliminar categoria"
      description={`Se eliminara la categoria "${target?.name}". Si tiene subcategorias o productos asociados, podrian verse afectados.`}
      onConfirm={handleConfirm}
      isLoading={isDeleting}
    />
  );
}
