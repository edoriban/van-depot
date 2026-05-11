/**
 * components/picking/picking-list-filters.tsx — controlled filter bar.
 *
 * Status `<Select>` + warehouse `<Select>` + optional "Asignadas a mí" button
 * toggle. State is owned by the consumer (URL search params are the source of
 * truth in `/picking/page.tsx`).
 *
 * Radix Select forbids `<SelectItem value="">` — we use a sentinel `__all__`
 * value and map it to `undefined` at the boundary so the consumer's filters
 * object stays clean.
 */
'use client';

import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { PICKING_LIST_STATUS_LABELS, type PickingListStatus } from '@/types';

import type { UsePickingListsFilters } from '@/lib/hooks/use-picking-lists';

const ALL_SENTINEL = '__all__';

const STATUS_OPTIONS: readonly PickingListStatus[] = [
  'draft',
  'released',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
];

export interface PickingListFiltersProps {
  filters: UsePickingListsFilters;
  onChange: (next: UsePickingListsFilters) => void;
  warehouses: { id: string; name: string }[];
  showAssignedToMeToggle?: boolean;
  className?: string;
}

export function PickingListFilters({
  filters,
  onChange,
  warehouses,
  showAssignedToMeToggle = false,
  className,
}: PickingListFiltersProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isAssignedToMe =
    Boolean(currentUserId) && filters.assigned_to_user_id === currentUserId;

  const handleStatusChange = useCallback(
    (next: string) => {
      onChange({
        ...filters,
        status:
          next === ALL_SENTINEL ? undefined : (next as PickingListStatus),
      });
    },
    [filters, onChange],
  );

  const handleWarehouseChange = useCallback(
    (next: string) => {
      onChange({
        ...filters,
        warehouse_id: next === ALL_SENTINEL ? undefined : next,
      });
    },
    [filters, onChange],
  );

  const handleAssignedToggle = useCallback(() => {
    if (!currentUserId) return;
    onChange({
      ...filters,
      assigned_to_user_id: isAssignedToMe ? undefined : currentUserId,
    });
  }, [currentUserId, filters, isAssignedToMe, onChange]);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        className,
      )}
    >
      <Select
        value={filters.status ?? ALL_SENTINEL}
        onValueChange={handleStatusChange}
      >
        <SelectTrigger className="w-[180px]" aria-label="Filtrar por estado">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_SENTINEL}>Todos los estados</SelectItem>
          {STATUS_OPTIONS.map((status) => (
            <SelectItem key={status} value={status}>
              {PICKING_LIST_STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.warehouse_id ?? ALL_SENTINEL}
        onValueChange={handleWarehouseChange}
      >
        <SelectTrigger className="w-[200px]" aria-label="Filtrar por almacén">
          <SelectValue placeholder="Almacén" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_SENTINEL}>Todos los almacenes</SelectItem>
          {warehouses.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showAssignedToMeToggle ? (
        <Button
          type="button"
          variant={isAssignedToMe ? 'default' : 'outline'}
          aria-pressed={isAssignedToMe}
          onClick={handleAssignedToggle}
          disabled={!currentUserId}
        >
          Asignadas a mí
        </Button>
      ) : null}
    </div>
  );
}
