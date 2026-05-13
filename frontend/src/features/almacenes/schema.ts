/**
 * features/almacenes/schema.ts — Zod schemas for the almacenes forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7.1
 * (Migration pattern).
 *
 * PR-7 (this commit) ships `warehouseFormSchema` (LIST page Nuevo/Editar
 * almacen dialog). PR-8 will extend the file with `locationFormSchema` for
 * the DETAIL page locations tree dialog.
 *
 * Schemas validate at submit-time only (`safeParse`) — no on-keystroke
 * validation. Matches productos precedent.
 */
import { z } from 'zod';

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// --- Warehouse form (LIST page Nuevo/Editar almacen dialog) -------------

export const warehouseFormSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(200),
  // Empty string → undefined so the payload omits the field when blank
  // (matches current behavior: `address: formAddress || undefined`).
  address: optionalTrimmedString(500),
});
export type WarehouseFormInput = z.infer<typeof warehouseFormSchema>;
