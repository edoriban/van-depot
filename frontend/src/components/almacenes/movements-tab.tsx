/**
 * components/almacenes/movements-tab.tsx — Movimientos tab content for the
 * `/almacenes/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-7.
 *
 * Carries `relativeDate` helper + `MOVEMENT_LABELS` + `MOVEMENT_COLORS`
 * constants inline (design §2.2 — single consumer). Reads `movementsPage`
 * from the DETAIL slice + dispatches `setMovementsPage`. Consumes
 * `useWarehouseMovements(warehouseId, page)`.
 *
 * Preserves: 5 columns (Tipo, Cantidad, Referencia, Notas, Fecha); the
 * `EmptyState` with `No hay movimientos en este almacen`.
 */
'use client';

import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouseMovements } from '@/lib/hooks/use-warehouse-movements';
import type { Movement, MovementType } from '@/types';

const PER_PAGE = 20;

const MOVEMENT_LABELS: Record<MovementType, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
};

const MOVEMENT_COLORS: Record<MovementType, string> = {
  entry: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  exit: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  transfer: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  adjustment:
    'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

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
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface MovementsTabProps {
  warehouseId: string;
}

export function MovementsTab({ warehouseId }: MovementsTabProps) {
  const page = useAlmacenesScreenStore((s) => s.movementsPage);
  const setPage = useAlmacenesScreenStore((s) => s.setMovementsPage);
  const { data: movements, total, isLoading, error } = useWarehouseMovements(
    warehouseId,
    page,
    PER_PAGE,
  );

  const columns: ColumnDef<Movement>[] = [
    {
      key: 'type',
      header: 'Tipo',
      render: (m) => (
        <Badge className={MOVEMENT_COLORS[m.movement_type]}>
          {MOVEMENT_LABELS[m.movement_type]}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (m) => <span className="font-medium">{m.quantity}</span>,
    },
    {
      key: 'reference',
      header: 'Referencia',
      render: (m) =>
        m.reference || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'notes',
      header: 'Notas',
      render: (m) =>
        m.notes || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'date',
      header: 'Fecha',
      render: (m) => relativeDate(m.created_at),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {total} movimiento{total !== 1 ? 's' : ''} registrado
        {total !== 1 ? 's' : ''}
      </p>

      {error !== undefined && error !== null && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : 'Error al cargar movimientos'}
        </div>
      )}

      <DataTable
        columns={columns}
        data={movements}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay movimientos registrados"
        emptyState={
          <EmptyState
            icon={ArrowDataTransferHorizontalIcon}
            title="No hay movimientos en este almacen"
            description="Los movimientos de entrada, salida y transferencia apareceran aqui."
          />
        }
      />
    </div>
  );
}
