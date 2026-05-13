/**
 * components/work-orders/work-order-table.tsx — paginated work-order list
 * table for the `/ordenes-de-trabajo` page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Owns the columns + the `<DataTable>` wiring. The parent owns the
 * paginated fetch (via `useWorkOrders`) and the page number; this
 * component receives them as props. Lookup data (warehouses, locations,
 * manufactured products) is fetched here through `useResourceList` so the
 * cache is shared with the filter bar and the create dialog via SWR
 * dedup on identical cache keys.
 */
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { cn } from '@/lib/utils';
import {
  WORK_ORDER_STATUS_BADGE_CLASSES,
  WORK_ORDER_STATUS_LABELS,
  type Location,
  type Product,
  type Warehouse,
  type WorkOrder,
} from '@/types';
import { FactoryIcon } from '@hugeicons/core-free-icons';

interface WorkOrderTableProps {
  data: WorkOrder[];
  total: number;
  page: number;
  perPage: number;
  isLoading: boolean;
  /**
   * Current warehouse filter from the URL. Lifted to the parent so this
   * subcomponent stays Suspense-boundary friendly per
   * `nextjs-no-use-search-params-without-suspense`.
   */
  filterWarehouseId: string;
  onPageChange: (page: number) => void;
  onCreateClick: () => void;
}

export function WorkOrderTable({
  data,
  total,
  page,
  perPage,
  isLoading,
  filterWarehouseId,
  onPageChange,
  onCreateClick,
}: WorkOrderTableProps) {
  // Lookup data — SWR dedups by cache key so this fetches piggy-back on
  // the filter-bar's identical calls.
  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');
  const { data: products } = useResourceList<Product>('/products', {
    is_manufactured: true,
    per_page: 200,
  });
  const { data: filterWarehouseLocations } = useResourceList<Location>(
    filterWarehouseId ? `/warehouses/${filterWarehouseId}/locations` : null,
  );

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w])),
    [warehouses],
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const locationMap = useMemo(() => {
    const m = new Map<string, Location>();
    for (const l of filterWarehouseLocations) m.set(l.id, l);
    return m;
  }, [filterWarehouseLocations]);

  const columns: ColumnDef<WorkOrder>[] = [
    {
      key: 'code',
      header: 'Codigo',
      render: (w) => (
        <Link
          href={`/ordenes-de-trabajo/${w.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
          data-testid="work-order-detail-link"
        >
          {w.code}
        </Link>
      ),
    },
    {
      key: 'fg',
      header: 'Producto terminado',
      render: (w) => {
        const p = productMap.get(w.fg_product_id);
        return p ? (
          <span>
            <span className="font-medium">{p.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {p.sku}
            </span>
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {w.fg_product_id.slice(0, 8)}…
          </span>
        );
      },
    },
    {
      key: 'fg_quantity',
      header: 'Cantidad',
      render: (w) => w.fg_quantity,
    },
    {
      key: 'warehouse',
      header: 'Almacen',
      render: (w) =>
        warehouseMap.get(w.warehouse_id)?.name ?? (
          <span className="font-mono text-xs text-muted-foreground">
            {w.warehouse_id.slice(0, 8)}…
          </span>
        ),
    },
    {
      key: 'work_center',
      header: 'Centro',
      render: (w) =>
        locationMap.get(w.work_center_location_id)?.name ?? (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (w) => (
        <Badge
          variant="outline"
          className={cn('border-0', WORK_ORDER_STATUS_BADGE_CLASSES[w.status])}
          data-testid="work-order-status-badge"
          data-status={w.status}
        >
          {WORK_ORDER_STATUS_LABELS[w.status]}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Creada',
      render: (w) =>
        new Date(w.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (w) => (
        <Link
          href={`/ordenes-de-trabajo/${w.id}`}
          className="text-sm text-primary hover:underline"
        >
          Ver detalle
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      total={total}
      page={page}
      perPage={perPage}
      onPageChange={onPageChange}
      isLoading={isLoading}
      emptyMessage="No hay ordenes que coincidan con los filtros."
      emptyState={
        <EmptyState
          icon={FactoryIcon}
          title="No hay ordenes que coincidan con los filtros"
          description="Crea una para empezar."
          actionLabel="Nueva orden"
          onAction={onCreateClick}
        />
      }
    />
  );
}
