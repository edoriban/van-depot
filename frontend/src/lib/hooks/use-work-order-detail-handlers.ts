/**
 * lib/hooks/use-work-order-detail-handlers.ts — orchestrated issue / complete
 * / cancel handlers for the work-order detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR), §7.1 (Migration pattern) and
 * `sdd/frontend-migration/design` §3.3 — the page-level handlers wrap the
 * raw mutation bundle with error routing (insufficient-stock surface,
 * invalid-transition Spanish copy) and store-side lifecycle (`setMutating`,
 * `setMissingMaterials`, dialog close). Bundling them keeps the detail-page
 * shell under the 300-LOC cap (FS spec STRUCT-6).
 *
 * Returns three async handlers and one click-router for the "Cancelar"
 * button which decides between opening the confirm dialog (in_progress) or
 * firing the cancel mutation directly (draft).
 */
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useWorkOrdersScreenStore } from '@/features/work-orders/store';
import { api, isApiError } from '@/lib/api-mutations';
import { useWorkOrderActions } from '@/lib/hooks/use-work-order-actions';
import type {
  MissingMaterial,
  Product,
  WorkOrderDetail,
} from '@/types';

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

export interface UseWorkOrderDetailHandlersResult {
  productMap: Map<string, Product>;
  handleIssue: () => Promise<void>;
  handleComplete: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleCancelClick: () => void;
}

export function useWorkOrderDetailHandlers(
  workOrder: WorkOrderDetail | null,
  refresh: () => Promise<unknown>,
): UseWorkOrderDetailHandlersResult {
  const actions = useWorkOrderActions(workOrder?.id ?? '');
  const closeIssueDialog = useWorkOrdersScreenStore((s) => s.closeIssueDialog);
  const openCancelDialog = useWorkOrdersScreenStore((s) => s.openCancelDialog);
  const closeCancelDialog = useWorkOrdersScreenStore(
    (s) => s.closeCancelDialog,
  );
  const setMissingMaterials = useWorkOrdersScreenStore(
    (s) => s.setMissingMaterials,
  );
  const setMutating = useWorkOrdersScreenStore((s) => s.setMutating);

  // Product-name map populated on-demand for the insufficient-stock surface.
  const [productMap, setProductMap] = useState<Map<string, Product>>(
    new Map(),
  );

  const handleIssue = async () => {
    if (!workOrder) return;
    setMutating(true);
    try {
      await actions.issue({});
      toast.success('Orden entregada — materiales transferidos al centro');
      closeIssueDialog();
      setMissingMaterials(null);
      await refresh();
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
      setMutating(false);
    }
  };

  const handleComplete = async () => {
    if (!workOrder) return;
    setMutating(true);
    try {
      await actions.complete({});
      setMissingMaterials(null);
      toast.success('Orden completada', {
        description: 'Se creo un lote de producto terminado.',
      });
      await refresh();
    } catch (err) {
      if (isApiError(err) && err.code === 'INSUFFICIENT_WORK_ORDER_STOCK') {
        const missing = (err.body?.missing as MissingMaterial[]) ?? [];
        setMissingMaterials(missing);
        const unknown: string[] = [];
        for (const m of missing) {
          if (!productMap.has(m.product_id)) unknown.push(m.product_id);
        }
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
      setMutating(false);
    }
  };

  const handleCancel = async () => {
    if (!workOrder) return;
    setMutating(true);
    try {
      await actions.cancel();
      closeCancelDialog();
      toast.success('Orden cancelada');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cancelar la orden',
      );
    } finally {
      setMutating(false);
    }
  };

  const handleCancelClick = () => {
    if (!workOrder) return;
    if (workOrder.status === 'in_progress') {
      openCancelDialog();
    } else {
      void handleCancel();
    }
  };

  return {
    productMap,
    handleIssue,
    handleComplete,
    handleCancel,
    handleCancelClick,
  };
}
