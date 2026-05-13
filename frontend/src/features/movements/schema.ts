/**
 * features/movements/schema.ts — Zod schemas for the six movimientos forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7.1
 * (Migration pattern).
 *
 * Each form variant exports a schema plus its `z.infer`-derived input type.
 * Quantities are accepted as either `string` (from the controlled `<Input
 * type="number">`) or `number`; `z.coerce.number()` normalizes both shapes.
 *
 * Date fields (`batchDate`, `expirationDate`) are received as ISO `YYYY-MM-DD`
 * strings from `<Input type="date">`; the schemas leave them as strings and
 * defer parsing to the backend, matching today's payload shape.
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

const optionalDateString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// --- Entry simple ---------------------------------------------------------

export const entrySimpleSchema = z.object({
  productId: idSchema,
  toLocationId: idSchema,
  quantity: z.coerce.number().positive(),
  supplierId: idSchema.optional(),
  reference: optionalTrimmedString(120),
  notes: optionalTrimmedString(500),
});

export type EntrySimpleInput = z.infer<typeof entrySimpleSchema>;

// --- Entry with lot -------------------------------------------------------

export const entryWithLotSchema = z.object({
  productId: idSchema,
  warehouseId: idSchema,
  lotNumber: z.string().trim().min(1, 'Numero de lote requerido'),
  goodQuantity: z.coerce.number().positive(),
  defectQuantity: z.coerce.number().nonnegative().optional(),
  supplierId: idSchema.optional(),
  batchDate: optionalDateString,
  expirationDate: optionalDateString,
  notes: optionalTrimmedString(500),
});

export type EntryWithLotInput = z.infer<typeof entryWithLotSchema>;

// --- Entry with PO --------------------------------------------------------

export const entryWithPoSchema = z.object({
  purchaseOrderId: idSchema,
  purchaseOrderLineId: idSchema,
  warehouseId: idSchema,
  lotNumber: z.string().trim().min(1, 'Numero de lote requerido'),
  goodQuantity: z.coerce.number().positive(),
  defectQuantity: z.coerce.number().nonnegative().optional(),
  batchDate: optionalDateString,
  expirationDate: optionalDateString,
  notes: optionalTrimmedString(500),
});

export type EntryWithPoInput = z.infer<typeof entryWithPoSchema>;

// --- Exit -----------------------------------------------------------------

export const exitSchema = z.object({
  productId: idSchema,
  fromLocationId: idSchema,
  quantity: z.coerce.number().positive(),
  reference: optionalTrimmedString(120),
  notes: optionalTrimmedString(500),
});

export type ExitInput = z.infer<typeof exitSchema>;

// --- Transfer (with from != to cross-field check) ------------------------

export const transferSchema = z
  .object({
    productId: idSchema,
    fromLocationId: idSchema,
    toLocationId: idSchema,
    quantity: z.coerce.number().positive(),
    reference: optionalTrimmedString(120),
    notes: optionalTrimmedString(500),
  })
  .superRefine((data, ctx) => {
    if (data.fromLocationId === data.toLocationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toLocationId'],
        message: 'La ubicacion destino debe ser diferente de la origen',
      });
    }
  });

export type TransferInput = z.infer<typeof transferSchema>;

// --- Adjustment -----------------------------------------------------------

export const adjustmentSchema = z.object({
  productId: idSchema,
  locationId: idSchema,
  newQuantity: z.coerce.number().nonnegative(),
  reference: optionalTrimmedString(120),
  notes: optionalTrimmedString(500),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
