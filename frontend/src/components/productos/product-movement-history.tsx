/**
 * components/productos/product-movement-history.tsx — paginated movement
 * history card on the product detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-DETAIL-INV-4 + design §4.5.
 *
 * Consumes `useProductMovements(productId, { perPage: 20, startDate })`
 * with the 6-month start date computed once at mount. Carries the
 * `movementTypeConfig` map + `formatDate` helper inline (single consumer
 * per design §2.2).
 *
 * STRICT equivalence with the pre-refactor MovementHistory subcomponent:
 * skeleton on first load, empty-state copy, 5-column table, conditional
 * `Cargar mas` button when `movements.length < total`.
 */
'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProductMovements } from '@/lib/hooks/use-product-movements';
import { cn } from '@/lib/utils';
import type { MovementType } from '@/types';

const movementTypeConfig: Record<MovementType, { label: string; className: string }> = {
  entry: { label: 'Entrada', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  exit: { label: 'Salida', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  transfer: { label: 'Transferencia', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  adjustment: { label: 'Ajuste', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ProductMovementHistoryProps {
  productId: string;
}

export function ProductMovementHistory({ productId }: ProductMovementHistoryProps) {
  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString();
  }, []);

  const { movements, isLoading, hasMore, loadMore } = useProductMovements(
    productId,
    { perPage: 20, startDate: sixMonthsAgo },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de movimientos</CardTitle>
        <CardDescription>
          Movimientos de los ultimos 6 meses
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && movements.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12 ml-auto" />
              </div>
            ))}
          </div>
        ) : movements.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            No hay movimientos registrados en los ultimos 6 meses
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origen / Destino</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((mov) => {
                  const config = movementTypeConfig[mov.movement_type];
                  return (
                    <TableRow key={mov.id}>
                      <TableCell>
                        <Badge variant="outline" className={cn('border-0', config.className)}>
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-xs">
                          {mov.from_location_id ?? '—'} → {mov.to_location_id ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">{mov.quantity}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {mov.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatDate(mov.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoading}
                >
                  {isLoading ? 'Cargando...' : 'Cargar mas'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
