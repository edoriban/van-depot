/**
 * features/work-orders/schema.ts — Zod schemas for the work-orders forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7.1
 * (Migration pattern).
 *
 * Today exports the create-WO schema consumed by the `Nueva orden` dialog
 * on `/ordenes-de-trabajo`. PR-4 may extend this file with the (tiny)
 * cancel-reason schema for the detail page.
 */
import { z } from 'zod';
import { idSchema } from '@/lib/schemas/id';

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// --- Create work order ----------------------------------------------------

export const workOrderCreateSchema = z.object({
  recipeId: idSchema,
  fgProductId: idSchema,
  fgQuantity: z.coerce.number().positive(),
  warehouseId: idSchema,
  workCenterId: idSchema,
  notes: optionalTrimmedString(500),
});

export type CreateWorkOrderInput = z.infer<typeof workOrderCreateSchema>;
