/**
 * components/work-orders/work-order-missing-materials-surface.tsx — inline
 * insufficient-stock surface for the work-order detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Spec WO-INV-3 LOAD-BEARING: when POST /complete returns 409
 * `INSUFFICIENT_WORK_ORDER_STOCK`, the missing rows MUST render INLINE
 * (NEVER as a toast). This component owns that surface.
 *
 * Pure presentational — the parent owns the dismissal action (which clears
 * the store's `missingMaterials` slot) and the retry handler (which calls
 * the actions bundle's `complete`).
 */
'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MissingMaterial, Product, WorkOrderMaterial } from '@/types';

interface WorkOrderMissingMaterialsSurfaceProps {
  missingMaterials: MissingMaterial[];
  materials: WorkOrderMaterial[];
  productMap: Map<string, Product>;
  isMutating: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}

export function WorkOrderMissingMaterialsSurface({
  missingMaterials,
  materials,
  productMap,
  isMutating,
  onDismiss,
  onRetry,
}: WorkOrderMissingMaterialsSurfaceProps) {
  return (
    <Card
      className="border-destructive/40 bg-destructive/5"
      data-testid="insufficient-stock-surface"
    >
      <CardHeader>
        <CardTitle className="text-destructive">
          Stock insuficiente para completar
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Para completar esta orden necesitas reponer los siguientes
          materiales en el centro de trabajo.
        </p>
      </CardHeader>
      <CardContent>
        <div className="rounded-3xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Faltante</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missingMaterials.map((m) => {
                const p = productMap.get(m.product_id);
                const material = materials.find(
                  (mat) => mat.product_id === m.product_id,
                );
                const name =
                  p?.name ??
                  material?.product_name ??
                  m.product_id.slice(0, 8) + '…';
                const sku = p?.sku ?? material?.product_sku ?? m.product_id;
                return (
                  <TableRow
                    key={m.product_id}
                    data-testid="missing-material-row"
                  >
                    <TableCell>
                      <span className="font-medium">{name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {sku}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{m.expected}</TableCell>
                    <TableCell className="text-right">{m.available}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {m.shortfall}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss}>
            Cerrar
          </Button>
          <Button
            size="sm"
            onClick={onRetry}
            disabled={isMutating}
            data-testid="retry-complete-btn"
          >
            Reintentar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
