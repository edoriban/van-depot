/**
 * components/status-badge/registry.ts — visual + label mappings per variant.
 *
 * See `frontend/src/CONVENTIONS.md` §4 (Reusable primitives catalog).
 *
 * Note on label sources:
 *   - `product_class` re-exports `PRODUCT_CLASS_LABELS` and
 *     `PRODUCT_CLASS_BADGE_CLASSES` from `@/types` (the canonical source).
 *   - `movement`, `wo_status`, and `movement_reason` supply LOCAL label
 *     and badge-class maps because `frontend/src/types/index.ts` does not
 *     yet export `MOVEMENT_LABELS` / `WO_STATUS_LABELS` /
 *     `MOVEMENT_REASON_LABELS` — and FS-6.3 forbids editing that file in
 *     this change. The future `frontend-migration` change will move the
 *     local maps into `types/index.ts` and slim this registry.
 */
import {
  PRODUCT_CLASS_LABELS,
  PRODUCT_CLASS_BADGE_CLASSES,
  type MovementType,
  type WorkOrderStatus,
  type MovementReason,
  type ProductClass,
} from '@/types';

/** Neutral fallback tone for unknown (variant, value) pairs. */
export const NEUTRAL_TONE = 'bg-muted text-muted-foreground';

// --- movement (entry / exit / transfer / adjustment) ---

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  transfer: 'Traslado',
  adjustment: 'Ajuste',
};

export const MOVEMENT_BADGE_CLASSES: Record<MovementType, string> = {
  entry: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  exit: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  transfer: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  adjustment: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

// --- wo_status (draft / in_progress / completed / cancelled) ---

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Borrador',
  in_progress: 'En proceso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const WO_STATUS_BADGE_CLASSES: Record<WorkOrderStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_progress: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

// --- product_class — re-exported from @/types so types/index.ts remains the SoT ---

export { PRODUCT_CLASS_LABELS, PRODUCT_CLASS_BADGE_CLASSES };
export type { ProductClass };

// --- movement_reason (subset of common reasons; extend as needed) ---

export const MOVEMENT_REASON_LABELS: Partial<Record<MovementReason, string>> = {
  purchase_receive: 'Recepción',
  purchase_return: 'Devolución a proveedor',
  quality_reject: 'Rechazo de calidad',
  scrap: 'Scrap',
  loss_theft: 'Merma por robo',
  loss_damage: 'Merma por daño',
  production_input: 'Salida a producción',
  production_output: 'Entrada de producción',
  manual_adjustment: 'Ajuste manual',
  cycle_count: 'Conteo cíclico',
  wo_issue: 'Salida a OT',
  back_flush: 'Back-flush',
  wo_cancel_reversal: 'Reversa por cancelación',
};

export const MOVEMENT_REASON_BADGE_CLASSES: Partial<Record<MovementReason, string>> = {
  purchase_receive: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  purchase_return: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  quality_reject: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  scrap: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  loss_theft: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  loss_damage: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  production_input: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  production_output: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  manual_adjustment: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  cycle_count: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  wo_issue: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  back_flush: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  wo_cancel_reversal: 'bg-muted text-muted-foreground',
};

// --- variant resolver ---

export type StatusBadgeVariant =
  | 'movement'
  | 'wo_status'
  | 'product_class'
  | 'movement_reason';

export interface StatusBadgeLookup {
  label: string;
  toneClass: string;
}

/**
 * Resolve a (variant, value) pair to its label + tone class. Returns
 * `{ label: String(value), toneClass: NEUTRAL_TONE }` for unknown pairs
 * — never throws.
 */
export function resolveStatusBadge(
  variant: StatusBadgeVariant,
  value: string,
): StatusBadgeLookup {
  switch (variant) {
    case 'movement': {
      const v = value as MovementType;
      const label = MOVEMENT_LABELS[v];
      const toneClass = MOVEMENT_BADGE_CLASSES[v];
      if (label && toneClass) return { label, toneClass };
      break;
    }
    case 'wo_status': {
      const v = value as WorkOrderStatus;
      const label = WO_STATUS_LABELS[v];
      const toneClass = WO_STATUS_BADGE_CLASSES[v];
      if (label && toneClass) return { label, toneClass };
      break;
    }
    case 'product_class': {
      const v = value as ProductClass;
      const label = PRODUCT_CLASS_LABELS[v];
      const toneClass = PRODUCT_CLASS_BADGE_CLASSES[v];
      if (label && toneClass) return { label, toneClass };
      break;
    }
    case 'movement_reason': {
      const v = value as MovementReason;
      const label = MOVEMENT_REASON_LABELS[v];
      const toneClass = MOVEMENT_REASON_BADGE_CLASSES[v];
      if (label && toneClass) return { label, toneClass };
      break;
    }
  }
  return { label: String(value), toneClass: NEUTRAL_TONE };
}
