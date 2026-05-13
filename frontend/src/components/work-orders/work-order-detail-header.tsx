/**
 * components/work-orders/work-order-detail-header.tsx — header block for the
 * work-order detail page (back link, code, status badge, summary line,
 * timestamps row, collapsible notes).
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Pure presentational: receives the resolved WO + warehouse / work-center /
 * fg-product objects via props. All lookups live in the parent so this
 * component never fires its own SWR requests (mirrors `work-order-table`'s
 * separation of concerns).
 */
'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateMediumEs } from '@/lib/format';
import {
  WORK_ORDER_STATUS_BADGE_CLASSES,
  WORK_ORDER_STATUS_LABELS,
  type Location,
  type Product,
  type Warehouse,
  type WorkOrderDetail,
} from '@/types';

interface WorkOrderDetailHeaderProps {
  workOrder: WorkOrderDetail;
  warehouse: Warehouse | null;
  workCenter: Location | null;
  fgProduct: Product | null;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkOrderDetailHeader({
  workOrder,
  warehouse,
  workCenter,
  fgProduct,
}: WorkOrderDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/ordenes-de-trabajo"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Ordenes de trabajo
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{workOrder.code}</h1>
        <Badge
          variant="outline"
          className={cn(
            'border-0',
            WORK_ORDER_STATUS_BADGE_CLASSES[workOrder.status],
          )}
          data-testid="work-order-status-badge"
          data-status={workOrder.status}
        >
          {WORK_ORDER_STATUS_LABELS[workOrder.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground">
        {fgProduct?.name ?? workOrder.fg_product_id.slice(0, 8)} ×{' '}
        {workOrder.fg_quantity}
        {warehouse?.name ? ` — ${warehouse.name}` : ''}
        {workCenter?.name ? ` / ${workCenter.name}` : ''}
      </p>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span suppressHydrationWarning>
          Creada el {formatDateMediumEs(workOrder.created_at)}
        </span>
        {workOrder.issued_at && (
          <span data-testid="wo-issued-at">
            Entregada: {formatDateTime(workOrder.issued_at)}
          </span>
        )}
        {workOrder.completed_at && (
          <span data-testid="wo-completed-at">
            Completada: {formatDateTime(workOrder.completed_at)}
          </span>
        )}
        {workOrder.cancelled_at && (
          <span data-testid="wo-cancelled-at">
            Cancelada: {formatDateTime(workOrder.cancelled_at)}
          </span>
        )}
      </div>
      {workOrder.notes && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Notas
          </summary>
          <p className="mt-2 whitespace-pre-wrap rounded-3xl border bg-muted/30 p-3">
            {workOrder.notes}
          </p>
        </details>
      )}
    </div>
  );
}
