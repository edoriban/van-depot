/**
 * components/work-orders/work-order-materials-table.tsx — materials card for
 * the work-order detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Pure presentational: renders the expected/consumed columns + a progress
 * bar per row. The insufficient-stock surface lives in a sibling component
 * (`work-order-missing-materials-surface.tsx`) because it is a separate
 * load-bearing UI per WO-INV-3 (inline error, NOT a toast).
 */
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { WorkOrderMaterial } from '@/types';

interface WorkOrderMaterialsTableProps {
  materials: WorkOrderMaterial[];
}

export function WorkOrderMaterialsTable({
  materials,
}: WorkOrderMaterialsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Materiales</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-3xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Consumido</TableHead>
                <TableHead>Progreso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((m) => {
                const pct =
                  m.quantity_expected > 0
                    ? Math.min(
                        100,
                        (m.quantity_consumed / m.quantity_expected) * 100,
                      )
                    : 0;
                return (
                  <TableRow key={m.id} data-testid="wo-material-row">
                    <TableCell>
                      <span className="font-medium">
                        {m.product_name ?? m.product_id.slice(0, 8) + '…'}
                      </span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {m.product_sku ?? ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.quantity_expected}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.quantity_consumed}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {materials.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-sm text-muted-foreground"
                  >
                    Esta orden no tiene materiales registrados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
