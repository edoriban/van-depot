'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  api,
  cancelWorkOrder,
  completeWorkOrder,
  getWorkOrder,
  isApiError,
  issueWorkOrder,
} from '@/lib/api-mutations';
import type {
  Location,
  MissingMaterial,
  PaginatedResponse,
  Product,
  ProductLot,
  QualityStatus,
  Warehouse,
  WorkOrderDetail,
  WorkOrderMaterial,
} from '@/types';
import {
  WORK_ORDER_STATUS_BADGE_CLASSES,
  WORK_ORDER_STATUS_LABELS,
} from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const QUALITY_LABELS: Record<QualityStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  quarantine: 'Cuarentena',
};

const QUALITY_COLORS: Record<QualityStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  quarantine: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

function formatDateTime(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Spanish copy for the "from" state when a transition is rejected. The
// backend's body shape is `{from, to}` but we render only `from` because
// reading "from in_progress to in_progress" (a re-issue on an already-issued
// WO) is confusing per the Batch 5 note.
const TRANSITION_FROM_LABELS: Record<string, string> = {
  draft: 'Borrador',
  in_progress: 'En proceso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export default function OrdenDeTrabajoDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [workOrder, setWorkOrder] = useState<WorkOrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [workCenter, setWorkCenter] = useState<Location | null>(null);
  const [fgProduct, setFgProduct] = useState<Product | null>(null);
  // Product lookup for the materials table — resolved on-demand via a bulk
  // fetch since the detail endpoint already embeds `product_name` and
  // `product_sku` via JOIN. We keep the map only for the insufficient-stock
  // surface in case the backend changes the shape.
  const [productMap, setProductMap] = useState<Map<string, Product>>(new Map());
  const [fgLot, setFgLot] = useState<ProductLot | null>(null);

  // Dialog/action state
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  // Insufficient-stock surface — SPEC §4 load-bearing UI. Populated only on
  // 409 `INSUFFICIENT_WORK_ORDER_STOCK`; never surfaced via toast. Stays
  // visible until the user closes it or the WO flips out of in_progress.
  const [missingMaterials, setMissingMaterials] = useState<
    MissingMaterial[] | null
  >(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const wo = await getWorkOrder(id);
      setWorkOrder(wo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Resolve secondary references (warehouse, work-center, FG product) once
  // the WO loads. These are "nice to have" labels — any failure falls back
  // to the UUID prefix.
  useEffect(() => {
    if (!workOrder) return;
    let cancelled = false;
    void api
      .get<Warehouse>(`/warehouses/${workOrder.warehouse_id}`)
      .then((w) => {
        if (!cancelled) setWarehouse(w);
      })
      .catch(() => {});
    void api
      .get<Location[] | PaginatedResponse<Location>>(
        `/warehouses/${workOrder.warehouse_id}/locations`,
      )
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data;
        if (!cancelled) {
          const wc = list.find((l) => l.id === workOrder.work_center_location_id);
          setWorkCenter(wc ?? null);
        }
      })
      .catch(() => {});
    void api
      .get<Product>(`/products/${workOrder.fg_product_id}`)
      .then((p) => {
        if (!cancelled) setFgProduct(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workOrder]);

  // Resolve the FG lot once the WO lands in `completed`. The backend doesn't
  // embed the lot in the WO response, so we derive it via the deterministic
  // naming convention `WO-<code>-<YYYYMMDD>` from design §6b.
  useEffect(() => {
    if (!workOrder || workOrder.status !== 'completed') {
      setFgLot(null);
      return;
    }
    let cancelled = false;
    // `/products/{id}/lots` returns an array of ProductLot (no pagination
    // envelope per the existing repo shape).
    void api
      .get<ProductLot[] | PaginatedResponse<ProductLot>>(
        `/products/${workOrder.fg_product_id}/lots`,
      )
      .then((res) => {
        if (cancelled) return;
        const lots = Array.isArray(res) ? res : res.data;
        // The completion uses today's date at the server — scan for the
        // prefix `WO-<code>-` to be robust to timezone skew between client
        // and server.
        const prefix = `WO-${workOrder.code}-`;
        const match = lots.find((l) => l.lot_number.startsWith(prefix)) ?? null;
        setFgLot(match);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workOrder]);

  const handleIssue = async () => {
    if (!workOrder) return;
    setIsMutating(true);
    try {
      await issueWorkOrder(workOrder.id, {});
      toast.success('Orden entregada — materiales transferidos al centro');
      setIssueDialogOpen(false);
      setMissingMaterials(null);
      await reload();
    } catch (err) {
      if (isApiError(err) && err.code === 'WORK_ORDER_INVALID_TRANSITION') {
        const from = (err.body?.from as string) ?? 'desconocido';
        toast.error(
          `No se puede entregar esta orden desde el estado "${
            TRANSITION_FROM_LABELS[from] ?? from
          }".`,
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Error al entregar la orden',
        );
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleComplete = async () => {
    if (!workOrder) return;
    setIsMutating(true);
    try {
      await completeWorkOrder(workOrder.id, {});
      setMissingMaterials(null);
      toast.success('Orden completada', {
        description: 'Se creo un lote de producto terminado.',
      });
      await reload();
    } catch (err) {
      if (isApiError(err) && err.code === 'INSUFFICIENT_WORK_ORDER_STOCK') {
        const missing = (err.body?.missing as MissingMaterial[]) ?? [];
        setMissingMaterials(missing);
        // Pre-fetch product names for any product_ids we don't already know
        // so the surface can render human-readable rows. Missing entries
        // might not overlap with the BOM materials (e.g. if the BOM snapshot
        // changed) so we resolve explicitly.
        const unknown = missing
          .map((m) => m.product_id)
          .filter((pid) => !productMap.has(pid));
        if (unknown.length > 0) {
          void Promise.all(
            unknown.map((pid) =>
              api.get<Product>(`/products/${pid}`).catch(() => null),
            ),
          ).then((results) => {
            setProductMap((prev) => {
              const next = new Map(prev);
              for (const p of results) {
                if (p) next.set(p.id, p);
              }
              return next;
            });
          });
        }
      } else if (
        isApiError(err) &&
        err.code === 'WORK_ORDER_INVALID_TRANSITION'
      ) {
        const from = (err.body?.from as string) ?? 'desconocido';
        toast.error(
          `No se puede completar esta orden desde el estado "${
            TRANSITION_FROM_LABELS[from] ?? from
          }".`,
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Error al completar la orden',
        );
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleCancel = async () => {
    if (!workOrder) return;
    setIsMutating(true);
    try {
      await cancelWorkOrder(workOrder.id);
      setCancelDialogOpen(false);
      toast.success('Orden cancelada');
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cancelar la orden',
      );
    } finally {
      setIsMutating(false);
    }
  };

  const materials: WorkOrderMaterial[] = useMemo(
    () => workOrder?.materials ?? [],
    [workOrder],
  );

  const materialCount = materials.length;

  if (isLoading && !workOrder) {
    return (
      <div className="space-y-4" data-testid="work-order-loading">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div className="space-y-4" data-testid="work-order-error">
        <p className="text-destructive">
          {error ?? 'No se pudo cargar la orden de trabajo.'}
        </p>
        <Button variant="outline" onClick={() => router.push('/ordenes-de-trabajo')}>
          Volver al listado
        </Button>
      </div>
    );
  }

  const canIssue = workOrder.status === 'draft';
  const canComplete = workOrder.status === 'in_progress';
  const canCancel =
    workOrder.status === 'draft' || workOrder.status === 'in_progress';

  return (
    <div className="space-y-6" data-testid="work-order-detail-page">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/ordenes-de-trabajo"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Ordenes de trabajo
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold">{workOrder.code}</h1>
          <Badge
            variant="outline"
            className={cn(
              'border-0',
              WORK_ORDER_STATUS_BADGE_CLASSES[workOrder.status],
            )}
            data-testid="work-order-status-badge"
            data-status={workOrder.status}
          >
            {WORK_ORDER_STATUS_LABELS[workOrder.status]}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          {fgProduct?.name ?? workOrder.fg_product_id.slice(0, 8)} ×{' '}
          {workOrder.fg_quantity}
          {warehouse?.name ? ` — ${warehouse.name}` : ''}
          {workCenter?.name ? ` / ${workCenter.name}` : ''}
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            Creada el{' '}
            {new Date(workOrder.created_at).toLocaleString('es-MX', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          {workOrder.issued_at && (
            <span data-testid="wo-issued-at">
              Entregada: {formatDateTime(workOrder.issued_at)}
            </span>
          )}
          {workOrder.completed_at && (
            <span data-testid="wo-completed-at">
              Completada: {formatDateTime(workOrder.completed_at)}
            </span>
          )}
          {workOrder.cancelled_at && (
            <span data-testid="wo-cancelled-at">
              Cancelada: {formatDateTime(workOrder.cancelled_at)}
            </span>
          )}
        </div>
        {workOrder.notes && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Notas
            </summary>
            <p className="mt-2 whitespace-pre-wrap rounded-3xl border bg-muted/30 p-3">
              {workOrder.notes}
            </p>
          </details>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2" data-testid="wo-actions">
        {canIssue && (
          <Button
            onClick={() => setIssueDialogOpen(true)}
            data-testid="issue-wo-btn"
          >
            Entregar
          </Button>
        )}
        {canComplete && (
          <Button
            onClick={handleComplete}
            disabled={isMutating}
            data-testid="complete-wo-btn"
          >
            {isMutating ? 'Completando...' : 'Completar'}
          </Button>
        )}
        {canCancel && (
          <Button
            variant={workOrder.status === 'in_progress' ? 'destructive' : 'outline'}
            onClick={() => {
              if (workOrder.status === 'in_progress') {
                setCancelDialogOpen(true);
              } else {
                void handleCancel();
              }
            }}
            disabled={isMutating}
            data-testid="cancel-wo-btn"
          >
            Cancelar
          </Button>
        )}
      </div>

      {/* Insufficient-stock surface — visible per-row error. This is a SPEC
          §4 requirement: the 409 response from POST /complete must be shown
          row-by-row, not as a toast. */}
      {missingMaterials && missingMaterials.length > 0 && (
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
                    const sku =
                      p?.sku ?? material?.product_sku ?? m.product_id;
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
                        <TableCell className="text-right">
                          {m.expected}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.available}
                        </TableCell>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMissingMaterials(null)}
              >
                Cerrar
              </Button>
              <Button
                size="sm"
                onClick={handleComplete}
                disabled={isMutating}
                data-testid="retry-complete-btn"
              >
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Materials table */}
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

      {/* FG lot panel — visible only when the WO is completed */}
      {workOrder.status === 'completed' && (
        <Card data-testid="wo-fg-lot-panel">
          <CardHeader>
            <CardTitle>Lote de producto terminado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fgLot ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm">{fgLot.lot_number}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'border-0',
                      QUALITY_COLORS[fgLot.quality_status],
                    )}
                    data-testid="fg-lot-quality-badge"
                  >
                    {QUALITY_LABELS[fgLot.quality_status]}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {fgProduct?.name ?? workOrder.fg_product_id.slice(0, 8)} ×{' '}
                  {workOrder.fg_quantity}
                  {fgLot.expiration_date
                    ? ` — Caduca ${new Date(
                        fgLot.expiration_date,
                      ).toLocaleDateString('es-MX')}`
                    : ''}
                </div>
                <Link
                  href={`/lotes/${fgLot.id}`}
                  className="text-sm text-primary hover:underline"
                  data-testid="fg-lot-link"
                >
                  Ver lote {fgLot.lot_number}
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Resolviendo informacion del lote…
              </p>
            )}
            <Link
              href={`/movimientos?work_order_id=${workOrder.id}`}
              className="block text-sm text-primary hover:underline"
              data-testid="wo-movements-link"
            >
              Ver movimientos de esta orden →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Issue confirmation dialog */}
      <ConfirmDialog
        open={issueDialogOpen}
        onOpenChange={(open) => !open && setIssueDialogOpen(false)}
        title="Entregar orden"
        description="¿Entregar esta orden? Los materiales se transferirán al centro de trabajo."
        confirmLabel="Entregar"
        onConfirm={handleIssue}
        isLoading={isMutating}
      />

      {/* Cancel-from-in_progress confirmation dialog */}
      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => !open && setCancelDialogOpen(false)}
        title="Cancelar orden en proceso"
        description={`Se revertirán ${materialCount} transferencias al cancelar esta orden. Esta acción no se puede deshacer.`}
        confirmLabel="Confirmar cancelación"
        onConfirm={handleCancel}
        isLoading={isMutating}
      />
    </div>
  );
}
