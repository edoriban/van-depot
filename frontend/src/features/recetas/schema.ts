/**
 * features/recetas/schema.ts — Zod schemas for the recetas forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7
 * (Migration pattern).
 *
 * **PR-9** shipped `recipeFormSchema` (LIST create + DETAIL edit dialogs).
 * **PR-10 (this commit)** adds `recipeItemFormSchema` for the add-item
 * dialog inside the DETAIL page.
 *
 * Schemas validate at submit-time only (`safeParse`) — no on-keystroke
 * validation. Matches productos + almacenes precedent.
 */
import { z } from 'zod';

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// --- Recipe form (LIST create + DETAIL edit dialog) ---------------------

export const recipeFormSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(200),
  // Empty string → undefined so the payload omits the field when blank
  // (matches current behavior: `description: formDescription || undefined`).
  description: optionalTrimmedString(2000),
});
export type RecipeFormInput = z.infer<typeof recipeFormSchema>;

// --- Recipe item form (DETAIL add-item dialog) --------------------------

/**
 * Validates the add-item dialog payload before appending to `localItems`.
 * `productId` MUST be set and non-empty. `quantity` is coerced from the
 * controlled `<Input type="number">` string value and MUST be positive.
 * `notes` is optional and trimmed.
 */
export const recipeItemFormSchema = z.object({
  productId: z.string().trim().min(1, 'Producto requerido'),
  quantity: z.coerce.number().positive('Cantidad debe ser mayor a cero'),
  notes: optionalTrimmedString(500),
});
export type RecipeItemFormInput = z.infer<typeof recipeItemFormSchema>;
