/**
 * features/admin-tenants/schema.ts — Zod schemas for admin tenant forms.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod).
 *
 * Slug constraint mirrors backend migration A1
 * (`20260507000001_create_tenants.sql`):
 *   `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` (3-63 chars, no leading/trailing hyphen)
 * AND `slug NOT IN ('admin','api','www','public','auth')`.
 */
import { z } from 'zod';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'www',
  'public',
  'auth',
  'app',
  'system',
  'health',
]);

export const tenantSlugSchema = z
  .string()
  .trim()
  .min(3, 'Minimo 3 caracteres')
  .max(63, 'Maximo 63 caracteres')
  .regex(SLUG_REGEX, 'Solo minusculas, digitos y guion (sin acentos)')
  .refine((s) => !RESERVED_SLUGS.has(s), { message: 'Slug reservado, elige otro' });

export const tenantNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre es requerido')
  .max(255, 'Maximo 255 caracteres');

export const createTenantSchema = z.object({
  slug: tenantSlugSchema,
  name: tenantNameSchema,
});

export const updateTenantSchema = z.object({
  name: tenantNameSchema.optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const grantMembershipSchema = z.object({
  user_id: z.uuid('Debe ser un UUID valido'),
  role: z.enum(['owner', 'manager', 'operator']),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type GrantMembershipInput = z.infer<typeof grantMembershipSchema>;
