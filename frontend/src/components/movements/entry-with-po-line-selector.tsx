/**
 * components/movements/entry-with-po-line-selector.tsx — radio list of PO
 * lines with per-line received/ordered progress.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Extracted from `EntryWithPOForm` to keep that file under the 270-LOC cap
 * (design §R8 split rule).
 */
'use client';

import { Label } from '@/components/ui/label';
import type { PurchaseOrderLine } from '@/types';

export interface EntryWithPoLineSelectorProps {
  lines: PurchaseOrderLine[];
  selectedLineId: string;
  onChange: (lineId: string) => void;
}

export function EntryWithPoLineSelector({
  lines,
  selectedLineId,
  onChange,
}: EntryWithPoLineSelectorProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta orden no tiene lineas o ya fue completada.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Selecciona la linea a recibir</Label>
      <div className="rounded-lg border divide-y">
        {lines.map((line) => {
          const pending = line.quantity_ordered - line.quantity_received;
          const pct =
            line.quantity_ordered > 0
              ? (line.quantity_received / line.quantity_ordered) * 100
              : 0;
          return (
            <label
              key={line.id}
              htmlFor={`po-line-${line.id}`}
              aria-label={`Linea de OC: ${line.product_name ?? line.product_id}`}
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
            >
              <input
                id={`po-line-${line.id}`}
                type="radio"
                name="po-line"
                value={line.id}
                checked={selectedLineId === line.id}
                onChange={() => onChange(line.id)}
                className="mt-1"
                data-testid={`po-line-${line.id}`}
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">
                    {line.product_name ?? line.product_id.slice(0, 8) + '...'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Pendiente: {pending.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {line.quantity_received.toFixed(2)} / {line.quantity_ordered.toFixed(2)} recibido
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
