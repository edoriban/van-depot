/**
 * components/movements/movements-history-table.tsx — bottom-of-page
 * historial table + movement_type filter dropdown.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Owns the column definitions and the per-page size (`PER_PAGE = 20`).
 * New-row highlight animation is driven by the parent via the
 * `highlightNew` prop (true for ~2s after a submission). The export button
 * + Spanish label/color maps live in sibling files for §LOC compliance.
 *
 * The MovementType filter, page, and product map are passed in as props —
 * URL state is owned by the parent page shell.
 */
'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { formatDateTimeEs } from '@/lib/format';
import type { Product, WorkOrder } from '@/types';

import { MovementsHistoryExport } from './movements-history-export';
import {
  MOVEMENT_COLORS,
  MOVEMENT_LABELS,
  PER_PAGE,
  REASON_COLORS,
  REASON_LABELS,
  type MovementWithDetails,
} from './movements-history-labels';

export type { MovementWithDetails } from './movements-history-labels';
export { PER_PAGE } from './movements-history-labels';

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'hace un momento';
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays === 1) return 'ayer';
  if (diffDays < 7) return `hace ${diffDays} dias`;
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface MovementsHistoryTableProps {
  movements: MovementWithDetails[];
  total: number;
  page: number;
  isLoading: boolean;
  filterType: string;
  onFilterTypeChange: (next: string) => void;
  onPageChange: (next: number) => void;
  highlightNew: boolean;
  products: Product[];
  workOrderIdParam: string;
  filterWorkOrder: WorkOrder | null;
  onClearWorkOrderFilter: () => void;
}

export function MovementsHistoryTable({
  movements,
  total,
  page,
  isLoading,
  filterType,
  onFilterTypeChange,
  onPageChange,
  highlightNew,
  products,
  workOrderIdParam,
  filterWorkOrder,
  onClearWorkOrderFilter,
}: MovementsHistoryTableProps) {
  const productMap = new Map(products.map((p) => [p.id, p]));

  const getProductDisplay = (m: MovementWithDetails) => {
    if (m.product_name) return `${m.product_name} (${m.product_sku ?? ''})`;
    const p = productMap.get(m.product_id);
    return p ? `${p.name} (${p.sku})` : m.product_id;
  };

  const getOriginDisplay = (m: MovementWithDetails) => {
    if (m.from_location_name) return m.from_location_name;
    return m.from_location_id ? m.from_location_id.slice(0, 8) + '...' : '-';
  };

  const getDestDisplay = (m: MovementWithDetails) => {
    if (m.to_location_name) return m.to_location_name;
    return m.to_location_id ? m.to_location_id.slice(0, 8) + '...' : '-';
  };

  const columns: ColumnDef<MovementWithDetails>[] = [
    {
      key: 'type',
      header: 'Tipo',
      render: (m) => (
        <Badge className={MOVEMENT_COLORS[m.movement_type]} data-testid="movement-type-badge">
          {MOVEMENT_LABELS[m.movement_type]}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Razon',
      render: (m) =>
        m.movement_reason ? (
          <Badge className={REASON_COLORS[m.movement_reason]} data-testid="movement-reason-badge">
            {REASON_LABELS[m.movement_reason]}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'product',
      header: 'Producto',
      render: (m) => <span className="font-medium">{getProductDisplay(m)}</span>,
    },
    {
      key: 'locations',
      header: 'Origen → Destino',
      render: (m) => (
        <span>
          {getOriginDisplay(m)} → {getDestDisplay(m)}
        </span>
      ),
    },
    { key: 'quantity', header: 'Cantidad', render: (m) => m.quantity },
    {
      key: 'reference',
      header: 'Referencia',
      render: (m) => m.reference || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'date',
      header: 'Fecha',
      render: (m) => (
        <span title={formatDateTimeEs(m.created_at)} suppressHydrationWarning>
          {relativeDate(m.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {workOrderIdParam && (
        <div
          className="flex items-center gap-3 rounded-3xl border border-primary/40 bg-primary/5 px-4 py-3"
          data-testid="work-order-filter-chip"
        >
          <span className="text-sm text-muted-foreground">Filtrado por Orden:</span>
          <Link
            href={`/ordenes-de-trabajo/${workOrderIdParam}`}
            className="font-mono text-sm font-semibold text-primary hover:underline"
            data-testid="work-order-filter-code"
          >
            {filterWorkOrder?.code ?? workOrderIdParam.slice(0, 8) + '…'}
          </Link>
          <button
            type="button"
            onClick={onClearWorkOrderFilter}
            className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Quitar filtro de orden de trabajo"
            data-testid="clear-work-order-filter"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Historial de movimientos</h2>
        <div className="flex items-center gap-2">
          <MovementsHistoryExport movements={movements} disabled={movements.length === 0} />
          <Label htmlFor="filter-type" className="text-sm whitespace-nowrap">
            Filtrar por tipo:
          </Label>
          <Select
            value={filterType || 'all'}
            onValueChange={(val) => onFilterTypeChange(val === 'all' ? '' : val)}
          >
            <SelectTrigger data-testid="filter-movement-type" className="w-48">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="entry">Entrada</SelectItem>
              <SelectItem value="exit">Salida</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
              <SelectItem value="adjustment">Ajuste</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={movements}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={onPageChange}
        isLoading={isLoading}
        rowClassName={(_item, index) =>
          index === 0 && highlightNew ? 'animate-[highlight-row_2s_ease-out]' : ''
        }
        emptyMessage="No hay movimientos registrados"
        emptyState={
          <EmptyState
            icon={ArrowDataTransferHorizontalIcon}
            title="Aun no hay movimientos registrados"
            description="Registra tu primera entrada de material usando el formulario de arriba."
          />
        }
      />
    </div>
  );
}
