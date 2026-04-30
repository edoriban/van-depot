/**
 * components/status-badge/status-badge.tsx — variant-driven status badge.
 *
 * See `frontend/src/CONVENTIONS.md` §4 (Reusable primitives catalog).
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { resolveStatusBadge, type StatusBadgeVariant } from './registry';

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  value: string;
  className?: string;
}

/**
 * Render a tone-coded badge for a known (variant, value) pair, falling
 * back to a neutral muted-tone badge with the raw `value` when the
 * pair is unknown.
 *
 * @example
 *   <StatusBadge variant="movement" value={m.movement_type} />
 */
export function StatusBadge({ variant, value, className }: StatusBadgeProps) {
  const { label, toneClass } = resolveStatusBadge(variant, value);
  return (
    <Badge variant="outline" className={cn(toneClass, 'border-transparent', className)}>
      {label}
    </Badge>
  );
}
