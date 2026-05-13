/**
 * components/work-orders/work-order-fg-lot-banner.tsx — FG lot panel rendered
 * after a WO is completed.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Renders the lot number + quality badge + FG product summary + link to the
 * lot detail page + a breadcrumb link back to the linked movements. The
 * card stays mounted even while the lot is resolving so users get a
 * progress hint ("Resolviendo informacion del lote…") rather than a
 * flickering empty state — matches the legacy page's behavior.
 *
 * Pure presentational: the parent owns the SWR fetch for both
 * `fgProductLots` and the prefix-match derivation of the WO-bound lot.
 */
'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateEs } from '@/lib/format';
import type {
  Product,
  ProductLot,
  QualityStatus,
  WorkOrderDetail,
} from '@/types';

const QUALITY_LABELS: Record<QualityStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  quarantine: 'Cuarentena',
};

const QUALITY_COLORS: Record<QualityStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  quarantine:
    'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

interface WorkOrderFgLotBannerProps {
  workOrder: WorkOrderDetail;
  fgLot: ProductLot | null;
  fgProduct: Product | null;
}

export function WorkOrderFgLotBanner({
  workOrder,
  fgLot,
  fgProduct,
}: WorkOrderFgLotBannerProps) {
  return (
    <Card data-testid="wo-fg-lot-panel">
      <CardHeader>
        <CardTitle>Lote de producto terminado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fgLot ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm">{fgLot.lot_number}</span>
              <Badge
                variant="outline"
                className={cn(
                  'border-0',
                  QUALITY_COLORS[fgLot.quality_status],
                )}
                data-testid="fg-lot-quality-badge"
              >
                {QUALITY_LABELS[fgLot.quality_status]}
              </Badge>
            </div>
            <div
              className="text-sm text-muted-foreground"
              suppressHydrationWarning
            >
              {fgProduct?.name ?? workOrder.fg_product_id.slice(0, 8)} ×{' '}
              {workOrder.fg_quantity}
              {fgLot.expiration_date
                ? ` — Caduca ${formatDateEs(fgLot.expiration_date)}`
                : ''}
            </div>
            <Link
              href={`/lotes/${fgLot.id}`}
              className="text-sm text-primary hover:underline"
              data-testid="fg-lot-link"
            >
              Ver lote {fgLot.lot_number}
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Resolviendo informacion del lote…
          </p>
        )}
        <Link
          href={`/movimientos?work_order_id=${workOrder.id}`}
          className="block text-sm text-primary hover:underline"
          data-testid="wo-movements-link"
        >
          Ver movimientos de esta orden →
        </Link>
      </CardContent>
    </Card>
  );
}
