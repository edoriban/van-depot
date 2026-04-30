/**
 * lib/schemas/id.ts — branded UUID id schema.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod).
 */
import { z } from 'zod';

/**
 * UUID id schema. Brands the parsed string as `Id` so the type system
 * distinguishes ids from arbitrary strings at call boundaries.
 *
 * @example
 *   const productId: Id = idSchema.parse(params.id);
 */
export const idSchema = z.uuid().brand<'Id'>();

export type Id = z.infer<typeof idSchema>;
