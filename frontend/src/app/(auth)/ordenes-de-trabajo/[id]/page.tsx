/**
 * app/(auth)/ordenes-de-trabajo/[id]/page.tsx — thin orchestration shell for
 * the Work Order DETAIL screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern).
 *
 * Owns:
 *   - `id` route param resolution + the detail SWR fetch via `useWorkOrder`.
 *   - The single-record reference fetches for warehouse + fg product (design
 *     §3.2 exception — `useResourceList` is list-shaped only).
 *   - Composition of the detail subcomponents.
 *
 * Detail slice state (dialog flags, missing materials, in-flight spinner)
 * lives in `useWorkOrdersScreenStore` and is cleared on unmount via FS-2.2.
 * Action handlers + product-name map for the insufficient-stock surface
 * live in `useWorkOrderDetailHandlers` (separate hook so the page shell
 * stays under the 300-LOC cap from STRUCT-6).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { WorkOrderActionsBar } from '@/components/work-orders/work-order-actions-bar';
import { WorkOrderCancelDialog } from '@/components/work-orders/work-order-cancel-dialog';
import { WorkOrderDetailHeader } from '@/components/work-orders/work-order-detail-header';
import { WorkOrderFgLotBanner } from '@/components/work-orders/work-order-fg-lot-banner';
import { WorkOrderIssueDialog } from '@/components/work-orders/work-order-issue-dialog';
import { WorkOrderMaterialsTable } from '@/components/work-orders/work-order-materials-table';
import { WorkOrderMissingMaterialsSurface } from '@/components/work-orders/work-order-missing-materials-surface';
import { useWorkOrdersScreenStore } from '@/features/work-orders/store';
import { api } from '@/lib/api-mutations';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { useWorkOrder } from '@/lib/hooks/use-work-order';
import { useWorkOrderDetailHandlers } from '@/lib/hooks/use-work-order-detail-handlers';
import type { Location, Product, ProductLot, Warehouse } from '@/types';

export default function OrdenDeTrabajoDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useRouter();
  const id = params.id;

  // FS-2.2 — reset the detail slice when the page unmounts.
  useEffect(
    () => () => useWorkOrdersScreenStore.getState().resetDetail(),
    [],
  );

  // SWR-driven detail fetch (replaces the legacy useCallback+useState loop).
  const { data: workOrder, isLoading, error, refresh } = useWorkOrder(id);

  // Detail-slice store reads (granular selectors so re-renders stay local).
  const issueDialogOpen = useWorkOrdersScreenStore((s) => s.issueDialogOpen);
  const cancelDialogOpen = useWorkOrdersScreenStore(
    (s) => s.cancelDialogOpen,
  );
  const isMutating = useWorkOrdersScreenStore((s) => s.isMutating);
  const missingMaterials = useWorkOrdersScreenStore(
    (s) => s.missingMaterials,
  );
  const openIssueDialog = useWorkOrdersScreenStore((s) => s.openIssueDialog);
  const closeIssueDialog = useWorkOrdersScreenStore((s) => s.closeIssueDialog);
  const closeCancelDialog = useWorkOrdersScreenStore(
    (s) => s.closeCancelDialog,
  );
  const setMissingMaterials = useWorkOrdersScreenStore(
    (s) => s.setMissingMaterials,
  );

  const {
    productMap,
    handleIssue,
    handleComplete,
    handleCancel,
    handleCancelClick,
  } = useWorkOrderDetailHandlers(workOrder, refresh);

  // Single-record reference fetches — kept as direct `api.get` since
  // `useResourceList` is list-shaped only (design §3.2).
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [fgProduct, setFgProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (!workOrder) return;
    let cancelled = false;
    void api
      .get<Warehouse>(`/warehouses/${workOrder.warehouse_id}`)
      .then((w) => {
        if (!cancelled) setWarehouse(w);
      })
      .catch(() => {});
    void api
      .get<Product>(`/products/${workOrder.fg_product_id}`)
      .then((p) => {
        if (!cancelled) setFgProduct(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workOrder]);

  // Per-warehouse locations — SWR-keyed so cache is shared with siblings.
  const { data: warehouseLocations } = useResourceList<Location>(
    workOrder ? `/warehouses/${workOrder.warehouse_id}/locations` : null,
  );
  const workCenter = useMemo<Location | null>(() => {
    if (!workOrder) return null;
    return (
      warehouseLocations.find(
        (l) => l.id === workOrder.work_center_location_id,
      ) ?? null
    );
  }, [warehouseLocations, workOrder]);

  // FG product lot list — only fetched when the WO is completed. The lot is
  // derived via the deterministic naming convention `WO-<code>-<YYYYMMDD>`.
  const { data: fgProductLots } = useResourceList<ProductLot>(
    workOrder && workOrder.status === 'completed'
      ? `/products/${workOrder.fg_product_id}/lots`
      : null,
  );
  const fgLot = useMemo<ProductLot | null>(() => {
    if (!workOrder || workOrder.status !== 'completed') return null;
    const prefix = `WO-${workOrder.code}-`;
    return fgProductLots.find((l) => l.lot_number.startsWith(prefix)) ?? null;
  }, [fgProductLots, workOrder]);

  const materials = useMemo(() => workOrder?.materials ?? [], [workOrder]);
  const materialCount = materials.length;

  if (isLoading && !workOrder) {
    return (
      <div className="space-y-4" data-testid="work-order-loading">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (error || !workOrder) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo cargar la orden de trabajo.';
    return (
      <div className="space-y-4" data-testid="work-order-error">
        <p className="text-destructive">{message}</p>
        <Button variant="outline" onClick={() => push('/ordenes-de-trabajo')}>
          Volver al listado
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="work-order-detail-page">
      <WorkOrderDetailHeader
        workOrder={workOrder}
        warehouse={warehouse}
        workCenter={workCenter}
        fgProduct={fgProduct}
      />

      <WorkOrderActionsBar
        workOrder={workOrder}
        isMutating={isMutating}
        onIssueClick={openIssueDialog}
        onCompleteClick={handleComplete}
        onCancelClick={handleCancelClick}
      />

      {missingMaterials && missingMaterials.length > 0 && (
        <WorkOrderMissingMaterialsSurface
          missingMaterials={missingMaterials}
          materials={materials}
          productMap={productMap}
          isMutating={isMutating}
          onDismiss={() => setMissingMaterials(null)}
          onRetry={handleComplete}
        />
      )}

      <WorkOrderMaterialsTable materials={materials} />

      {workOrder.status === 'completed' && (
        <WorkOrderFgLotBanner
          workOrder={workOrder}
          fgLot={fgLot}
          fgProduct={fgProduct}
        />
      )}

      <WorkOrderIssueDialog
        open={issueDialogOpen}
        isLoading={isMutating}
        onConfirm={handleIssue}
        onOpenChange={(open) => !open && closeIssueDialog()}
      />

      <WorkOrderCancelDialog
        open={cancelDialogOpen}
        isLoading={isMutating}
        materialCount={materialCount}
        onConfirm={handleCancel}
        onOpenChange={(open) => !open && closeCancelDialog()}
      />
    </div>
  );
}
