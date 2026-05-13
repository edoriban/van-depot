/**
 * components/almacenes/warehouse-grid.tsx — grid container with skeleton,
 * empty-state, no-search-results, and warehouse-card branches.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-1 + ALM-LIST-INV-3.
 *
 * Branch matrix:
 *   isLoading                       → 3 skeleton cards
 *   originalCount === 0             → `<EmptyState>` (`Aun no tienes almacenes`)
 *   filtered.length === 0 (but originalCount > 0)
 *                                   → centered `Sin resultados` block
 *   otherwise                       → grid of `<WarehouseCard>`
 *
 * Receives all derived data + callbacks via props; does not read the store
 * directly. Preserves the `warehouse-grid` testid.
 */
'use client';

import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Store01Icon } from '@hugeicons/core-free-icons';
import type { Warehouse, WarehouseWithStats } from '@/types';
import { WarehouseCard } from './warehouse-card';

interface WarehouseGridProps {
  items: WarehouseWithStats[];
  isLoading: boolean;
  originalCount: number;
  searchQuery: string;
  onEdit: (warehouse: Warehouse) => void;
  onDelete: (warehouse: Warehouse) => void;
  onCreate: () => void;
}

export function WarehouseGrid({
  items,
  isLoading,
  originalCount,
  searchQuery,
  onEdit,
  onDelete,
  onCreate,
}: WarehouseGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-5 skeleton-shimmer rounded w-2/3" />
              <div className="h-4 skeleton-shimmer rounded w-1/2 mt-2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-12 skeleton-shimmer rounded" />
                ))}
              </div>
              <div className="h-3 skeleton-shimmer rounded w-full" />
              <div className="h-4 skeleton-shimmer rounded w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (originalCount === 0) {
    return (
      <EmptyState
        icon={Store01Icon}
        title="Aun no tienes almacenes"
        description="Crea tu primer almacen para organizar tu inventario."
        actionLabel="Nuevo almacen"
        onAction={onCreate}
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">Sin resultados</p>
        <p className="text-sm mt-1">
          No se encontraron almacenes que coincidan con &quot;{searchQuery}&quot;
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="warehouse-grid"
    >
      {items.map((warehouse, i) => (
        <WarehouseCard
          key={warehouse.id}
          warehouse={warehouse}
          index={i}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
