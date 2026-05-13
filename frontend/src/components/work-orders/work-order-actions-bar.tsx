/**
 * components/work-orders/work-order-actions-bar.tsx — `Entregar` / `Completar`
 * / `Cancelar` CTA strip for the work-order detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Pure presentational: derives the three "can…" flags from the WO status
 * and routes click events to parent-supplied handlers. The page owns the
 * mutation lifecycle and dialog open/close because both flow through the
 * shared `useWorkOrdersScreenStore` detail slice.
 */
'use client';

import { Button } from '@/components/ui/button';
import type { WorkOrderDetail } from '@/types';

interface WorkOrderActionsBarProps {
  workOrder: WorkOrderDetail;
  isMutating: boolean;
  onIssueClick: () => void;
  onCompleteClick: () => void;
  onCancelClick: () => void;
}

export function WorkOrderActionsBar({
  workOrder,
  isMutating,
  onIssueClick,
  onCompleteClick,
  onCancelClick,
}: WorkOrderActionsBarProps) {
  const canIssue = workOrder.status === 'draft';
  const canComplete = workOrder.status === 'in_progress';
  const canCancel =
    workOrder.status === 'draft' || workOrder.status === 'in_progress';

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="wo-actions">
      {canIssue && (
        <Button onClick={onIssueClick} data-testid="issue-wo-btn">
          Entregar
        </Button>
      )}
      {canComplete && (
        <Button
          onClick={onCompleteClick}
          disabled={isMutating}
          data-testid="complete-wo-btn"
        >
          {isMutating ? 'Completando...' : 'Completar'}
        </Button>
      )}
      {canCancel && (
        <Button
          variant={workOrder.status === 'in_progress' ? 'destructive' : 'outline'}
          onClick={onCancelClick}
          disabled={isMutating}
          data-testid="cancel-wo-btn"
        >
          Cancelar
        </Button>
      )}
    </div>
  );
}
