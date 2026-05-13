/**
 * components/work-orders/work-order-cancel-dialog.tsx — confirm dialog for
 * cancelling an in-progress work order.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Wraps `ConfirmDialog` with the destructive-flavored Spanish copy. The
 * description carries the count of material rows that will be reversed
 * (the message is load-bearing for WO-INV-3's "cancel reverses" scenario).
 * Open/close state lives in `useWorkOrdersScreenStore.cancelDialogOpen`.
 *
 * Design §8 leaves a hook for an optional cancel-reason field via a tiny
 * inline schema; we do NOT render an input yet because the legacy page
 * did not offer one. PR-4 keeps strict equivalence; the schema slot in
 * the store (`cancelReason`) is reserved for a follow-up SDD that adds
 * the optional textarea.
 */
'use client';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';

interface WorkOrderCancelDialogProps {
  open: boolean;
  isLoading: boolean;
  materialCount: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function WorkOrderCancelDialog({
  open,
  isLoading,
  materialCount,
  onConfirm,
  onOpenChange,
}: WorkOrderCancelDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancelar orden en proceso"
      description={`Se revertirán ${materialCount} transferencias al cancelar esta orden. Esta acción no se puede deshacer.`}
      confirmLabel="Confirmar cancelación"
      onConfirm={onConfirm}
      isLoading={isLoading}
    />
  );
}
