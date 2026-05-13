/**
 * features/almacenes/schema.ts — Zod schemas for the almacenes forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7.1
 * (Migration pattern).
 *
 * PR-7 shipped `warehouseFormSchema` (LIST page Nuevo/Editar almacen
 * dialog). **PR-8 (this commit)** extends the file with `locationFormSchema`
 * for the DETAIL page locations tree dialog.
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

// --- Location form (DETAIL page Nueva/Editar ubicacion dialog) ----------

const LOCATION_TYPE_ENUM = z.enum([
  'zone',
  'rack',
  'shelf',
  'position',
  'bin',
  'reception',
  'work_center',
  'finished_good',
  'outbound',
]);

export const locationFormSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(200),
  location_type: LOCATION_TYPE_ENUM,
  // Empty string → undefined so the payload omits the parent when none is
  // chosen (matches the current behavior:
  // `parent_id: formParentId || undefined`).
  parent_id: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type LocationFormInput = z.infer<typeof locationFormSchema>;
