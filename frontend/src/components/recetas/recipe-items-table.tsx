/**
 * components/recetas/recipe-items-table.tsx — DataTable + columns + caption
 * + EmptyState branches for the `/recetas/[id]` DETAIL page items section.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-1 + REC-DETAIL-INV-4.
 *
 * Reads nothing from the store — fully prop-driven:
 *   - `localItems`, `hasChanges` come from the page shell (which reads them
 *     from `useRecetasScreenStore`).
 *   - `onCreate` opens the add-item dialog (EmptyState CTA).
 *   - `onRemove(item)` sets the `removeTargetItem` store field so the
 *     ConfirmDialog sibling opens.
 *
 * Columns are memoized so the DataTable receives a stable reference.
 */
'use client';

import { useMemo } from 'react';
import { Delete01Icon, TaskDaily01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import type { RecipeItem } from '@/types';

interface RecipeItemsTableProps {
  localItems: RecipeItem[];
  hasChanges: boolean;
  onCreate: () => void;
  onRemove: (item: RecipeItem) => void;
}

export function RecipeItemsTable({
  localItems,
  hasChanges,
  onCreate,
  onRemove,
}: RecipeItemsTableProps) {
  const itemColumns: ColumnDef<RecipeItem>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Producto',
        render: (item) => (
          <div>
            <span className="font-medium">{item.product_name}</span>
            <span className="ml-2 font-mono text-sm text-muted-foreground">
              {item.product_sku}
            </span>
          </div>
        ),
      },
      {
        key: 'quantity',
        header: 'Cantidad',
        render: (item) => (
          <span className="font-medium">{item.quantity}</span>
        ),
      },
      {
        key: 'unit',
        header: 'Unidad',
        render: (item) => item.unit_of_measure,
      },
      {
        key: 'notes',
        header: 'Notas',
        render: (item) =>
          item.notes || <span className="text-muted-foreground">-</span>,
      },
      {
        key: 'actions',
        header: 'Acciones',
        render: (item) => (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onRemove(item)}
            data-testid="remove-item-btn"
          >
            <HugeiconsIcon icon={Delete01Icon} size={16} />
          </Button>
        ),
      },
    ],
    [onRemove],
  );

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        {localItems.length} material
        {localItems.length !== 1 ? 'es' : ''} en esta receta
        {hasChanges && (
          <span className="ml-2 text-amber-600 dark:text-amber-400">
            (cambios sin guardar)
          </span>
        )}
      </p>

      <DataTable
        columns={itemColumns}
        data={localItems}
        total={localItems.length}
        page={1}
        perPage={100}
        onPageChange={() => {}}
        isLoading={false}
        emptyMessage="No hay materiales en esta receta"
        emptyState={
          <EmptyState
            icon={TaskDaily01Icon}
            title="Sin materiales"
            description="Agrega productos a esta receta para definir los materiales necesarios."
            actionLabel="Agregar Material"
            onAction={onCreate}
          />
        }
      />
    </div>
  );
}
