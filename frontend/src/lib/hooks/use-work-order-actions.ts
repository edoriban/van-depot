/**
 * lib/hooks/use-work-order-actions.ts — typed mutation bundle for the
 * `/ordenes-de-trabajo/[id]` detail page (issue / complete / cancel).
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR), §7.1 (Migration pattern) and
 * `sdd/frontend-migration/design` §3.3 — three distinct mutation endpoints
 * warrant the bundle wrapper (mirrors `usePickingActions`).
 *
 * The hook returns three functions, each wrapping the corresponding
 * `lib/api-mutations` call. Error handling (toast routing, missing-material
 * extraction) stays at the call site so the page owns the user-facing
 * surface. The mutating-flag lifecycle is owned by the consumer too via
 * `useWorkOrdersScreenStore`'s `setMutating()` action.
 *
 * @example
 *   const { issue, complete, cancel } = useWorkOrderActions(id);
 *   await issue();
 */
'use client';

import {
  cancelWorkOrder,
  completeWorkOrder,
  issueWorkOrder,
} from '@/lib/api-mutations';
import type {
  CompleteWorkOrderInput,
  IssueWorkOrderInput,
  WorkOrder,
} from '@/types';

export interface UseWorkOrderActionsResult {
  issue: (body?: IssueWorkOrderInput) => Promise<WorkOrder>;
  complete: (body?: CompleteWorkOrderInput) => Promise<WorkOrder>;
  cancel: () => Promise<WorkOrder>;
}

export function useWorkOrderActions(id: string): UseWorkOrderActionsResult {
  return {
    issue: (body: IssueWorkOrderInput = {}) => issueWorkOrder(id, body),
    complete: (body: CompleteWorkOrderInput = {}) =>
      completeWorkOrder(id, body),
    cancel: () => cancelWorkOrder(id),
  };
}
