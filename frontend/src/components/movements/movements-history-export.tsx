/**
 * components/movements/movements-history-export.tsx — XLSX export trigger
 * for the historial table.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Extracted from `MovementsHistoryTable` to keep that file under the
 * 270-LOC cap. The shared label/color maps live in
 * `./movements-history-labels.ts` so this file stays focused on the export
 * column shape.
 */
'use client';

import { ExportButton } from '@/components/shared/export-button';
import { exportToExcel } from '@/lib/export-utils';
import { formatDateEs } from '@/lib/format';
import type { MovementReason, MovementType } from '@/types';

import { MOVEMENT_LABELS, REASON_LABELS } from './movements-history-labels';
import type { MovementWithDetails } from './movements-history-labels';

export interface MovementsHistoryExportProps {
  movements: MovementWithDetails[];
  disabled: boolean;
}

export function MovementsHistoryExport({ movements, disabled }: MovementsHistoryExportProps) {
  return (
    <ExportButton
      onExport={() =>
        exportToExcel(
          movements as unknown as Record<string, unknown>[],
          'movimientos',
          'Movimientos',
          [
            {
              key: 'created_at',
              label: 'Fecha',
              format: (v) => formatDateEs(v as string | undefined, ''),
            },
            {
              key: 'movement_type',
              label: 'Tipo',
              format: (v) => MOVEMENT_LABELS[v as MovementType] ?? String(v),
            },
            {
              key: 'product_id',
              label: 'Producto',
              format: (_v, row) => {
                const m = row as unknown as MovementWithDetails;
                return m.product_name ?? m.product_id;
              },
            },
            {
              key: 'product_sku',
              label: 'SKU',
              format: (_v, row) => {
                const m = row as unknown as MovementWithDetails;
                return m.product_sku ?? '';
              },
            },
            { key: 'quantity', label: 'Cantidad' },
            {
              key: 'movement_reason',
              label: 'Motivo',
              format: (v) => (v ? REASON_LABELS[v as MovementReason] ?? String(v) : ''),
            },
            {
              key: 'from_location_name',
              label: 'Origen',
              format: (_v, row) => {
                const m = row as unknown as MovementWithDetails;
                return m.from_location_name ?? m.from_location_id ?? '-';
              },
            },
            {
              key: 'to_location_name',
              label: 'Destino',
              format: (_v, row) => {
                const m = row as unknown as MovementWithDetails;
                return m.to_location_name ?? m.to_location_id ?? '-';
              },
            },
            { key: 'reference', label: 'Referencia', format: (v) => (v as string) ?? '' },
          ],
        )
      }
      disabled={disabled}
    />
  );
}
