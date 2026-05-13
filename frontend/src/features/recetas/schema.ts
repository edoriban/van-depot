/**
 * features/recetas/schema.ts — Zod schemas for the recetas forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7
 * (Migration pattern).
 *
 * **PR-9 (this commit)** ships `recipeFormSchema` (LIST page create dialog
 * + DETAIL page edit dialog in PR-10). **PR-10** will add
 * `recipeItemFormSchema` for the DETAIL page add-item dialog.
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

// --- Recipe form (LIST create + DETAIL edit dialog in PR-10) ------------

export const recipeFormSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(200),
  // Empty string → undefined so the payload omits the field when blank
  // (matches current behavior: `description: formDescription || undefined`).
  description: optionalTrimmedString(2000),
});
export type RecipeFormInput = z.infer<typeof recipeFormSchema>;
