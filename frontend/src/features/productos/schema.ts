/**
 * features/productos/schema.ts — Zod schemas for the productos forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod) and §7.1
 * (Migration pattern).
 *
 * Exports:
 * - `productCreateSchema` — the LIST page Nuevo producto dialog.
 * - `productEditSchema` — the LIST page Editar producto dialog (omits
 *   productClass and isManufactured — both are reclassify-only on edit —
 *   and adds isActive for the detail page in PR-6).
 * - `categoryFormSchema` — categories tab create/edit dialog.
 *
 * Cross-field invariants (tool_spare → hasExpiry=false, non-raw_material
 * cannot be isManufactured) are enforced at the submit-handler boundary
 * via payload coercion (mirrors current UI behavior). The schema accepts
 * any boolean for those fields; the coercion lives in the form components.
 */
import { z } from 'zod';

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const PRODUCT_CLASS_ENUM = z.enum([
  'raw_material',
  'consumable',
  'tool_spare',
]);
const UNIT_ENUM = z.enum([
  'piece',
  'kg',
  'gram',
  'liter',
  'ml',
  'meter',
  'cm',
  'box',
  'pack',
]);

const optionalNumber = z
  .union([
    z.coerce.number().min(0),
    z.literal('').transform(() => undefined),
  ])
  .optional();

// --- Product create -------------------------------------------------------

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(60),
  description: optionalTrimmedString(2000),
  // Empty string → undefined so the payload sends `category_id: undefined`
  // (matches current behavior: no category selected → omit the field).
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  unit: UNIT_ENUM,
  productClass: PRODUCT_CLASS_ENUM,
  hasExpiry: z.boolean(),
  isManufactured: z.boolean(),
  minStock: z.coerce.number().min(0),
  maxStock: optionalNumber,
});
export type CreateProductInput = z.infer<typeof productCreateSchema>;

// --- Product edit (detail page; class+isManufactured are reclassify-only) -

export const productEditSchema = productCreateSchema
  .omit({ productClass: true, isManufactured: true })
  .extend({
    isActive: z.boolean(),
  });
export type EditProductInput = z.infer<typeof productEditSchema>;

// --- Category form --------------------------------------------------------

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CategoryFormInput = z.infer<typeof categoryFormSchema>;
