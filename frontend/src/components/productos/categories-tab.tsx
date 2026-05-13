/**
 * components/productos/categories-tab.tsx — Categories tab content
 * (table + dialogs) for the productos LIST page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-7.
 *
 * Receives the global categories list from the page shell (used for the
 * parent picker + tree rendering). Drives its own paginated SWR view via
 * `useCategories({ page, per_page: 20 })`.
 *
 * Testids preserved verbatim: `new-category-btn`, `edit-category-btn`,
 * `delete-category-btn`.
 */
'use client';

import { useState } from 'react';
import { Tag01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { useProductosScreenStore } from '@/features/productos/store';
import { useCategories } from '@/lib/hooks/use-categories';
import type { Category } from '@/types';
import { CategoryCreateEditDialog } from './category-create-edit-dialog';
import { CategoryDeleteConfirm } from './category-delete-confirm';

const PER_PAGE = 20;

interface CategoriesTabProps {
  allCategories: Category[];
  /** Refresh the parent-owned global categories list after a CRUD action. */
  onAllCategoriesInvalidate: () => void;
}

export function CategoriesTab({
  allCategories,
  onAllCategoriesInvalidate,
}: CategoriesTabProps) {
  const [page, setPage] = useState(1);

  const openCreate = useProductosScreenStore((s) => s.openCreateCategory);
  const openEdit = useProductosScreenStore((s) => s.openEditCategory);
  const setDeleteTarget = useProductosScreenStore(
    (s) => s.setDeleteTargetCategory,
  );

  const {
    data: categories,
    total,
    isLoading,
    error: fetchError,
    refresh,
  } = useCategories({ page, per_page: PER_PAGE });

  const errorMessage =
    fetchError instanceof Error ? fetchError.message : null;

  const getParentName = (parentId?: string) => {
    if (!parentId)
      return <span className="text-muted-foreground">&mdash;</span>;
    const parent = allCategories.find((c) => c.id === parentId);
    return parent ? (
      parent.name
    ) : (
      <span className="text-muted-foreground">&mdash;</span>
    );
  };

  const handleSaved = () => {
    setPage(1);
    void refresh();
    onAllCategoriesInvalidate();
  };

  const handleDeleted = () => {
    void refresh();
    onAllCategoriesInvalidate();
  };

  const columns: ColumnDef<Category>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'parent',
      header: 'Padre',
      render: (c) => getParentName(c.parent_id),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (c) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEdit(c)}
            data-testid="edit-category-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(c)}
            data-testid="delete-category-btn"
          >
            Eliminar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate} data-testid="new-category-btn">
          Nueva categoria
        </Button>
      </div>

      {errorMessage && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <DataTable
        columns={columns}
        data={categories}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay categorias registradas"
        emptyState={
          <EmptyState
            icon={Tag01Icon}
            title="Aun no tienes categorias"
            description="Crea categorias para organizar tus productos."
            actionLabel="Nueva categoria"
            onAction={openCreate}
          />
        }
      />

      <CategoryCreateEditDialog
        allCategories={allCategories}
        onSaved={handleSaved}
      />
      <CategoryDeleteConfirm onDeleted={handleDeleted} />
    </div>
  );
}
