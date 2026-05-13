/**
 * components/almacenes/inventory-tab.tsx — Inventario tab content for the
 * `/almacenes/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-6.
 *
 * Carries the `StockBadge` component inline (design §2.2 — single
 * consumer). Reads `inventoryPage` from the DETAIL slice + dispatches
 * `setInventoryPage`. Consumes `useWarehouseInventory(warehouseId, page)`.
 *
 * Preserves: 5 columns (Producto, Ubicacion, Cantidad, Stock min, Estado);
 * `inventory-quantity` testid on the quantity cell; `stock-badge-critical`
 * / `stock-badge-low` / `stock-badge-ok` testids on the badge; the
 * `EmptyState` with `Ir a movimientos` action linking to `/movimientos`.
 */
'use client';

import { ClipboardIcon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouseInventory } from '@/lib/hooks/use-warehouse-inventory';
import type { InventoryItem } from '@/types';

const PER_PAGE = 20;

function StockBadge({
  quantity,
  minStock,
}: {
  quantity: number;
  minStock: number;
}) {
  if (quantity === 0) {
    return (
      <Badge
        className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        data-testid="stock-badge-critical"
      >
        Critico
      </Badge>
    );
  }
  if (quantity <= minStock) {
    return (
      <Badge
        className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
        data-testid="stock-badge-low"
      >
        Bajo
      </Badge>
    );
  }
  return (
    <Badge
      className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      data-testid="stock-badge-ok"
    >
      OK
    </Badge>
  );
}

interface InventoryTabProps {
  warehouseId: string;
}

export function InventoryTab({ warehouseId }: InventoryTabProps) {
  const page = useAlmacenesScreenStore((s) => s.inventoryPage);
  const setPage = useAlmacenesScreenStore((s) => s.setInventoryPage);
  const { data: items, total, isLoading, error } = useWarehouseInventory(
    warehouseId,
    page,
    PER_PAGE,
  );

  const columns: ColumnDef<InventoryItem>[] = [
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
      key: 'location',
      header: 'Ubicacion',
      render: (item) => item.location_name,
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (item) => (
        <span className="font-medium" data-testid="inventory-quantity">
          {item.quantity}
        </span>
      ),
    },
    {
      key: 'min_stock',
      header: 'Stock min',
      render: (item) => item.min_stock,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item) => (
        <StockBadge quantity={item.quantity} minStock={item.min_stock} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {total} registro{total !== 1 ? 's' : ''} de inventario
      </p>

      {error !== undefined && error !== null && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Error al cargar inventario'}
        </div>
      )}

      <DataTable
        columns={columns}
        data={items}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay registros de inventario"
        emptyState={
          <EmptyState
            icon={ClipboardIcon}
            title="No hay inventario en este almacen"
            description="Registra una entrada de material para ver el stock aqui."
            actionLabel="Ir a movimientos"
            actionHref="/movimientos"
          />
        }
      />
    </div>
  );
}
