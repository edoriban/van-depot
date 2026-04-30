/**
 * lib/schemas/pagination.ts — page/limit query primitive.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Validation with Zod).
 */
import { z } from 'zod';

/**
 * Query envelope describing standard `?page=&limit=` pagination.
 * Both fields default to common values; `safeParse` accepts string
 * inputs (typical when reading from `URLSearchParams`) and coerces.
 *
 * @example
 *   const { page, limit } = paginationQuerySchema.parse(
 *     Object.fromEntries(searchParams),
 *   );
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
