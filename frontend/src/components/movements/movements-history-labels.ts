/**
 * components/movements/movements-history-labels.ts — shared label/color
 * maps + MovementWithDetails row type for the historial subtree.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Co-located with the history table because these constants are bound to
 * its presentation (badge color classes, Spanish copy) and have no other
 * caller today. If a second consumer appears, graduate to `@/types` or a
 * shared `lib/movement-labels.ts` per the §6 dedupe heuristic.
 */
import type { Movement, MovementReason, MovementType } from '@/types';

export interface MovementWithDetails extends Movement {
  product_name?: string;
  product_sku?: string;
  from_location_name?: string;
  to_location_name?: string;
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
};

export const MOVEMENT_COLORS: Record<MovementType, string> = {
  entry: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  exit: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  transfer: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  adjustment: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

export const REASON_LABELS: Record<MovementReason, string> = {
  purchase_receive: 'Compra',
  purchase_return: 'Devolucion',
  quality_reject: 'Rechazo calidad',
  scrap: 'Desecho',
  loss_theft: 'Perdida/Robo',
  loss_damage: 'Perdida/Dano',
  production_input: 'Produccion (entrada)',
  production_output: 'Produccion (salida)',
  manual_adjustment: 'Ajuste manual',
  cycle_count: 'Conteo ciclico',
  wo_issue: 'OT — Entrega de material',
  back_flush: 'OT — Consumo (back-flush)',
  wo_cancel_reversal: 'Reversa por cancelacion',
};

export const REASON_COLORS: Record<MovementReason, string> = {
  purchase_receive: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  purchase_return: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  quality_reject: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  scrap: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  loss_theft: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  loss_damage: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  production_input: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  production_output: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  manual_adjustment: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  cycle_count: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  wo_issue: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  back_flush: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  wo_cancel_reversal: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
};

export const PER_PAGE = 20;
