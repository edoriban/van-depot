/**
 * components/picking/picking-line-row.tsx — desktop tabular row for picking lines.
 *
 * Renders as `<tr>` — caller wraps in `<table>`. 6 cells:
 *   line# / product / qty / assigned_lot / status (+inline detail) / actions.
 *
 * CTA visibility rule (locked decision #17 — hidden, not disabled):
 *   buttons render iff `listStatus === 'in_progress'` AND `line.status === 'pending'`
 *   AND the corresponding callback (`onPick` / `onSkip`) was supplied.
 *
 * Picked/skipped rows surface a tiny inline note (lot id / skip_reason)
 * truncated to a reasonable max width.
 */
'use client';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PickingLine, PickingListStatus } from '@/types';

export interface PickingLineRowProps {
  line: PickingLine;
  listStatus: PickingListStatus;
  productName?: string;
  onPick?: (lineId: string) => void;
  onSkip?: (lineId: string) => void;
  className?: string;
}

export function PickingLineRow({
  line,
  listStatus,
  productName,
  onPick,
  onSkip,
  className,
}: PickingLineRowProps) {
  const canAct =
    listStatus === 'in_progress' && line.status === 'pending';
  const showPick = canAct && Boolean(onPick);
  const showSkip = canAct && Boolean(onSkip);

  const displayProduct =
    productName ?? line.product_name ?? line.product_sku ?? line.product_id;

  const inlineDetail = (() => {
    if (line.status === 'picked' && line.picked_lot_id) {
      return `Lote ${line.picked_lot_id.slice(0, 8)}`;
    }
    if (line.status === 'skipped' && line.skip_reason) {
      return line.skip_reason;
    }
    return null;
  })();

  return (
    <tr className={cn('border-b border-border/60 text-sm', className)}>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {line.line_number ?? '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{displayProduct}</span>
          {line.product_sku && line.product_sku !== displayProduct ? (
            <span className="text-xs text-muted-foreground">
              {line.product_sku}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 font-mono tabular-nums">
        {line.requested_quantity}
        {line.picked_quantity != null &&
        line.picked_quantity !== line.requested_quantity ? (
          <span className="ml-1 text-xs text-muted-foreground">
            (rec: {line.picked_quantity})
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {line.assigned_lot_id ? (
          line.assigned_lot_id.slice(0, 8)
        ) : (
          <span className="text-muted-foreground">Sin asignar</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <StatusBadge variant="picking_line" value={line.status} />
          {inlineDetail ? (
            <span
              className="max-w-[200px] truncate text-xs text-muted-foreground"
              title={inlineDetail}
            >
              {inlineDetail}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {showPick ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onPick?.(line.id)}
              data-testid={`pick-line-${line.id}`}
            >
              Recolectar
            </Button>
          ) : null}
          {showSkip ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onSkip?.(line.id)}
              data-testid={`skip-line-${line.id}`}
            >
              Omitir
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
