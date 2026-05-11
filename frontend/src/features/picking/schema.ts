/**
 * features/picking/schema.ts — Zod schemas for the picking domain.
 *
 * Two reason schemas (skip + cancel) share the same shape (min 3 trimmed
 * chars, max 500). The optional-vs-required branch for the cancel reason is
 * handled by `CancelPickingDialog` outside the schema:
 *   - Empty trimmed input  → submit passes `undefined`.
 *   - Non-empty input      → MUST pass `cancelReasonSchema` (min 3 chars).
 *
 * `skipReasonSchema` is always required (skip can't proceed without a reason).
 */
import { z } from 'zod';

/** Skip reason — required, ≥3 trimmed chars (R8.1 + FS-1.2 locked decision #5). */
export const skipReasonSchema = z
  .string()
  .trim()
  .min(3, 'Mínimo 3 caracteres')
  .max(500, 'Máximo 500 caracteres');

/** Cancel reason — same shape, optionality handled outside the schema. */
export const cancelReasonSchema = z
  .string()
  .trim()
  .min(3, 'Mínimo 3 caracteres')
  .max(500, 'Máximo 500 caracteres');

export type SkipReasonInput = z.infer<typeof skipReasonSchema>;
export type CancelReasonInput = z.infer<typeof cancelReasonSchema>;
