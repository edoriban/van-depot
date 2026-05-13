/**
 * components/work-orders/work-order-issue-dialog.tsx — confirm dialog for
 * issuing (entregar) a work order from draft.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Wraps `ConfirmDialog` with the WO-specific Spanish copy. Open/close
 * state lives in `useWorkOrdersScreenStore.issueDialogOpen`; the confirm
 * handler is owned by the parent page so it can route the response
 * (success toast / known-error fallback) consistently with the legacy
 * implementation.
 */
'use client';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';

interface WorkOrderIssueDialogProps {
  open: boolean;
  isLoading: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function WorkOrderIssueDialog({
  open,
  isLoading,
  onConfirm,
  onOpenChange,
}: WorkOrderIssueDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Entregar orden"
      description="¿Entregar esta orden? Los materiales se transferirán al centro de trabajo."
      confirmLabel="Entregar"
      onConfirm={onConfirm}
      isLoading={isLoading}
    />
  );
}
