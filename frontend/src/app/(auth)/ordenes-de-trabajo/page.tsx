/**
 * app/(auth)/ordenes-de-trabajo/page.tsx — thin orchestration shell for the
 * Work Orders LIST screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern).
 *
 * Owns URL state (status / warehouse_id / work_center_location_id / search)
 * via `useSearchParams`. List slice state lives in
 * `useWorkOrdersScreenStore` (form open / draft / selected recipe) and is
 * cleared on unmount via the FS-2.2 cleanup effect. Subcomponents under
 * `components/work-orders/` render every visual element.
 */
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { WorkOrderCreateDialog } from '@/components/work-orders/work-order-create-dialog';
import { WorkOrderFilterBar } from '@/components/work-orders/work-order-filter-bar';
import { WorkOrderTable } from '@/components/work-orders/work-order-table';
import { useWorkOrdersScreenStore } from '@/features/work-orders/store';
import {
  useWorkOrders,
  type UseWorkOrdersFilters,
} from '@/lib/hooks/use-work-orders';
import type { WorkOrderStatus } from '@/types';

const PER_PAGE = 20;

function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return (
    value === 'draft' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'cancelled'
  );
}

function OrdenesDeTrabajoPageInner() {
  // NOTE: `react-doctor/react-compiler-destructure-method` flags
  // `searchParams.get(...)` here and suggests destructuring `get`. We DO
  // NOT destructure because `ReadonlyURLSearchParams` extends
  // `URLSearchParams` and `get` is an inherited prototype method —
  // destructured calls lose `this` and throw "Illegal invocation" at
  // runtime. Same rationale as `movimientos/page.tsx`.
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get('status');
  const filterStatus: WorkOrderStatus | undefined = isWorkOrderStatus(rawStatus)
    ? rawStatus
    : undefined;
  const filterWarehouseId = searchParams.get('warehouse_id') ?? '';
  const filterWorkCenterId = searchParams.get('work_center_location_id') ?? '';
  const filterSearch = searchParams.get('search') ?? '';

  const openCreateDialog = useWorkOrdersScreenStore((s) => s.openCreateDialog);

  // FS-2.2 — reset the list slice when the page unmounts.
  useEffect(
    () => () => useWorkOrdersScreenStore.getState().resetList(),
    [],
  );

  const [page, setPage] = useState(1);

  // `WorkOrderFilterBar` invokes this whenever the URL filter changes so
  // we reset pagination synchronously with the URL update (matches the
  // original page's `setPage(1)` behavior on filter changes).
  const handleFilterChange = () => {
    setPage(1);
  };

  const filters: UseWorkOrdersFilters = {
    page,
    per_page: PER_PAGE,
    status: filterStatus,
    warehouse_id: filterWarehouseId || undefined,
    work_center_location_id: filterWorkCenterId || undefined,
    search: filterSearch || undefined,
  };

  const {
    data: workOrders,
    total,
    isLoading,
    refresh,
  } = useWorkOrders(filters);

  const handleCreated = () => {
    setPage(1);
    void refresh();
  };

  return (
    <div className="space-y-6" data-testid="ordenes-de-trabajo-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ordenes de trabajo</h1>
          <p className="text-muted-foreground mt-1">
            Planifica, entrega y completa ordenes para fabricar producto
            terminado desde tus recetas.
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-work-order-btn">
          Nueva orden
        </Button>
      </div>

      <WorkOrderFilterBar
        filterStatus={filterStatus ?? null}
        filterWarehouseId={filterWarehouseId}
        filterWorkCenterId={filterWorkCenterId}
        filterSearch={filterSearch}
        onFilterChange={handleFilterChange}
      />

      <WorkOrderTable
        data={workOrders}
        total={total}
        page={page}
        perPage={PER_PAGE}
        isLoading={isLoading}
        filterWarehouseId={filterWarehouseId}
        onPageChange={setPage}
        onCreateClick={openCreateDialog}
      />

      <WorkOrderCreateDialog onCreated={handleCreated} />
    </div>
  );
}

export default function OrdenesDeTrabajoPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <OrdenesDeTrabajoPageInner />
    </Suspense>
  );
}
