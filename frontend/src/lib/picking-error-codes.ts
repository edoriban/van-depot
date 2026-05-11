/**
 * lib/picking-error-codes.ts — Spanish error-code copy for the picking domain.
 *
 * Exposes:
 *   - `PICKING_ERROR_CODE_MAP` — 8 static stable codes from the locked wire
 *     contract (Sem 2 #509 + Sem 3 #525).
 *   - `buildPickingCodeMap(err?)` — closure that returns the static map PLUS
 *     the 3 structured codes whose Spanish copy interpolates body fields:
 *       · `insufficient_stock` — from `body.details.length`
 *       · `lot_override_invalid` — from `body.reason` (5 sub-reasons)
 *       · `incomplete_lines` — from `body.pending_count`
 *     Plus `illegal_picking_list_transition` is enriched from `body.from/body.to`
 *     when present (design §7 example).
 *
 * Consumed by `use-picking-actions.ts::wrap()` which passes the result to
 * `surfaceApiError(err, { codeMap })`.
 */

import type { ApiError } from '@/lib/api-mutations';

type Body = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

const LOT_OVERRIDE_REASONS: Record<string, string> = {
  unknown_lot: 'Lote desconocido.',
  product_mismatch: 'El lote no corresponde al producto.',
  not_in_warehouse: 'El lote no está en este almacén.',
  not_consumable: 'El lote no es consumible (rechazado o en cuarentena).',
  insufficient_quantity: 'Cantidad insuficiente en el lote.',
};

/**
 * Static Spanish copy for the 8 stable picking error codes. The 3 structured
 * codes (`insufficient_stock`, `lot_override_invalid`, `incomplete_lines`)
 * are added at runtime by `buildPickingCodeMap` so they can interpolate
 * body fields.
 */
export const PICKING_ERROR_CODE_MAP: Record<string, string> = {
  illegal_picking_list_transition: 'Transición no permitida para esta lista.',
  picking_list_not_editable: 'La lista no se puede editar en este estado.',
  picking_list_not_found: 'Lista de picking no encontrada.',
  forbidden_role: 'No tienes permisos para esta acción.',
  not_picker_of_list: 'No estás asignado a esta lista.',
  picker_not_member_of_tenant: 'El usuario no pertenece a este tenant.',
  picking_line_warehouse_mismatch: 'La línea no pertenece al almacén de la lista.',
  outbound_location_missing: 'Falta la ubicación de despacho en el almacén.',
};

/**
 * Build a per-error codeMap closure that interpolates body details for the
 * structured codes. Pass the result to `surfaceApiError(err, { codeMap })`.
 *
 * @example
 *   surfaceApiError(err, {
 *     codeMap: buildPickingCodeMap(isApiError(err) ? err : undefined),
 *   });
 */
export function buildPickingCodeMap(err?: ApiError): Record<string, string> {
  const body: Body = (err?.body ?? {}) as Body;

  const reason = asString(body.reason);
  const pendingCount = asNumber(body.pending_count);
  const detailsLen = Array.isArray(body.details)
    ? (body.details as unknown[]).length
    : undefined;
  const from = asString(body.from);
  const to = asString(body.to);

  return {
    ...PICKING_ERROR_CODE_MAP,
    illegal_picking_list_transition:
      from && to
        ? `Transición no permitida: ${from} → ${to}.`
        : PICKING_ERROR_CODE_MAP.illegal_picking_list_transition,
    insufficient_stock:
      detailsLen !== undefined
        ? `Stock insuficiente en ${detailsLen} línea(s).`
        : 'Stock insuficiente para completar la operación.',
    lot_override_invalid:
      reason && LOT_OVERRIDE_REASONS[reason]
        ? LOT_OVERRIDE_REASONS[reason]
        : 'Lote inválido.',
    incomplete_lines:
      pendingCount !== undefined
        ? `Faltan ${pendingCount} línea(s) por completar.`
        : 'Hay líneas pendientes.',
  };
}
