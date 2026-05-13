/**
 * components/work-orders/work-order-filter-bar.tsx — chip strip + search +
 * warehouse / work-center dropdowns for the `/ordenes-de-trabajo` list page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * All filter state lives in the URL (`?status=`, `?warehouse_id=`,
 * `?work_center_location_id=`, `?search=`) per design §2.2 — URL prevails so
 * filters survive reloads + deep-links. Lookup data (warehouses + per-
 * warehouse locations) is fetched here via `useResourceList<T>` and shared
 * across the chip row, the warehouse select, and the work-center select.
 */
'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import { cn } from '@/lib/utils';
import {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VALUES,
  type Location,
  type Warehouse,
  type WorkOrderStatus,
} from '@/types';

// Chip ordering MUST match the original page so `STATUS_CHIPS[0] = Todos`
// followed by the 4 backend status enum values (load-bearing for the
// `status-chip-*` data-testid contract asserted in e2e).
const STATUS_CHIPS: ReadonlyArray<{
  value: WorkOrderStatus | null;
  label: string;
  testId: string;
}> = [
  { value: null, label: 'Todos', testId: 'status-chip-all' },
  ...WORK_ORDER_STATUS_VALUES.map((v) => ({
    value: v,
    label: WORK_ORDER_STATUS_LABELS[v],
    testId: `status-chip-${v}`,
  })),
] as const;

interface WorkOrderFilterBarProps {
  /**
   * Current URL filter values. The parent owns the `useSearchParams()` read
   * (so this subcomponent stays Suspense-boundary friendly per
   * `nextjs-no-use-search-params-without-suspense`) and forwards the decoded
   * values here.
   */
  filterStatus: WorkOrderStatus | null;
  filterWarehouseId: string;
  filterWorkCenterId: string;
  filterSearch: string;
  /**
   * Invoked AFTER the URL update so the page can reset its pagination
   * `page` state to 1 (the URL-driven filter does not include `?page=`).
   */
  onFilterChange?: () => void;
}

export function WorkOrderFilterBar({
  filterStatus,
  filterWarehouseId,
  filterWorkCenterId,
  filterSearch,
  onFilterChange,
}: WorkOrderFilterBarProps) {
  const { replace } = useRouter();

  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');
  // Locations for the selected warehouse — null path = inert when no
  // warehouse is selected. SWR cache key is shared with consumers elsewhere
  // (e.g. the work-orders-table maps work-center ids to names).
  const { data: filterWarehouseLocations } = useResourceList<Location>(
    filterWarehouseId ? `/warehouses/${filterWarehouseId}/locations` : null,
  );

  const workCenterLocations = useMemo(() => {
    if (!filterWarehouseId) return [] as Location[];
    return filterWarehouseLocations.filter(
      (l) => l.location_type === 'work_center',
    );
  }, [filterWarehouseLocations, filterWarehouseId]);

  const updateQueryParam = (name: string, value: string | null) => {
    // Read pathname + current search inside the handler so this component
    // does NOT re-render on every navigation event
    // (rerender-defer-reads-hook). Reading `window.location.search` directly
    // also keeps this off `useSearchParams`, which is what removed the
    // Suspense-boundary warning when the parent lifted the filter reads.
    const currentPath = window.location.pathname;
    const sp = new URLSearchParams(window.location.search);
    if (value === null || value === '') {
      sp.delete(name);
    } else {
      sp.set(name, value);
    }
    const qs = sp.toString();
    replace(qs ? `${currentPath}?${qs}` : currentPath, { scroll: false });
  };

  const handleStatusChipClick = (next: WorkOrderStatus | null) => {
    updateQueryParam('status', next);
    onFilterChange?.();
  };

  const handleWarehouseFilterChange = (id: string) => {
    updateQueryParam('warehouse_id', id || null);
    // Dropping the warehouse drops the work-center too (they're nested).
    updateQueryParam('work_center_location_id', null);
    onFilterChange?.();
  };

  const handleWorkCenterFilterChange = (id: string) => {
    updateQueryParam('work_center_location_id', id || null);
    onFilterChange?.();
  };

  const handleSearchChange = (value: string) => {
    updateQueryParam('search', value || null);
    onFilterChange?.();
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Filtrar por estado de orden"
        data-testid="status-chip-row"
      >
        {STATUS_CHIPS.map((chip) => {
          const isActive = filterStatus === chip.value;
          return (
            <button
              key={chip.testId}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleStatusChipClick(chip.value)}
              data-testid={chip.testId}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Buscar codigo, FG o SKU..."
          value={filterSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-sm"
          data-testid="search-input"
        />
        <SearchableSelect
          value={filterWarehouseId || 'all'}
          onValueChange={(val) =>
            handleWarehouseFilterChange(val === 'all' ? '' : val)
          }
          options={[
            { value: 'all', label: 'Todos los almacenes' },
            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
          ]}
          placeholder="Todos los almacenes"
          searchPlaceholder="Buscar almacen..."
          className="max-w-xs"
        />
        <SearchableSelect
          value={filterWorkCenterId || 'all'}
          onValueChange={(val) =>
            handleWorkCenterFilterChange(val === 'all' ? '' : val)
          }
          options={[
            { value: 'all', label: 'Todos los centros' },
            ...workCenterLocations.map((l) => ({
              value: l.id,
              label: l.name,
            })),
          ]}
          placeholder={
            filterWarehouseId
              ? 'Todos los centros'
              : 'Selecciona un almacen primero'
          }
          searchPlaceholder="Buscar centro..."
          disabled={!filterWarehouseId}
          className="max-w-xs"
        />
      </div>
    </>
  );
}
