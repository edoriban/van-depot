/**
 * components/picking/picking-list-card.tsx — list-item card for `/picking`.
 *
 * Header: `picking_number` (mono) + `<StatusBadge variant="picking_list">`.
 * Body:   customer_reference (if set), line count, assigned-to label.
 * Footer: relative timestamp (inline helper — no extra deps).
 *
 * Tappable surface with `role="button"`, `min-h-[88px]` mobile tap target,
 * Enter/Space keyboard activation.
 */
'use client';

import { useCallback, type KeyboardEvent } from 'react';

import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PickingListSummary } from '@/types';

export interface PickingListCardProps {
  list: PickingListSummary;
  onClick?: () => void;
  className?: string;
}

export function PickingListCard({
  list,
  onClick,
  className,
}: PickingListCardProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onClick) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    },
    [onClick],
  );

  const assignedLabel = list.assigned_to_user_id
    ? `Asignada a ${list.assigned_to_user_id.slice(0, 8)}`
    : 'Sin asignar';

  return (
    <Card
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'min-h-[88px] cursor-pointer gap-3 p-5 transition hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !onClick && 'cursor-default',
        className,
      )}
      size="sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-sm font-medium text-foreground">
          {list.picking_number}
        </span>
        <StatusBadge variant="picking_list" value={list.status} />
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {list.customer_reference ? (
          <span className="truncate" title={list.customer_reference}>
            Cliente: {list.customer_reference}
          </span>
        ) : null}
        <span>
          {list.line_count} {list.line_count === 1 ? 'línea' : 'líneas'}
        </span>
        <span>{assignedLabel}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {formatRelative(list.created_at)}
      </div>
    </Card>
  );
}

/** Inline relative-time helper — avoids pulling in `date-fns` for one component. */
function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffMs = Date.now() - ts;
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return 'Hace unos segundos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Date(ts).toLocaleDateString('es-MX');
}
