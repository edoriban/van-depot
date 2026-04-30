/**
 * lib/api.ts — non-mutation API helpers.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and §4
 * (Reusable primitives catalog) for usage rules.
 */
import { toast } from 'sonner';
import { isApiError } from '@/lib/api-mutations';

/**
 * Normalize a list response that may arrive as a raw `T[]` or as a
 * paginated envelope `{ data: T[] }`. Returns `[]` for any other shape
 * (including `null`/`undefined`/`{}`) without throwing — the caller
 * always receives an array.
 *
 * @example
 *   const products = unwrapList<Product>(await api.get('/products'));
 */
export function unwrapList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (
    res !== null &&
    typeof res === 'object' &&
    'data' in res &&
    Array.isArray((res as { data: unknown }).data)
  ) {
    return (res as { data: T[] }).data;
  }
  return [];
}

export interface SurfaceApiErrorOptions {
  /** Map of `ApiError.code` → user-facing Spanish label. */
  codeMap?: Record<string, string>;
  /** Fallback message when neither `codeMap` nor `err.message` apply. */
  fallback?: string;
}

/**
 * Dispatch a `toast.error` (sonner) for any thrown value. Order:
 *   1. ApiError + matching codeMap entry → mapped label
 *   2. ApiError with non-empty message → err.message
 *   3. Anything else → opts.fallback ?? "Ocurrió un error inesperado"
 *
 * Side-effect only — never re-throws, returns `void`.
 *
 * @example
 *   try { await createWorkOrder(input); }
 *   catch (err) {
 *     surfaceApiError(err, {
 *       codeMap: { INSUFFICIENT_STOCK: 'Stock insuficiente' },
 *       fallback: 'No se pudo crear la orden',
 *     });
 *   }
 */
export function surfaceApiError(
  err: unknown,
  opts?: SurfaceApiErrorOptions,
): void {
  try {
    if (isApiError(err)) {
      const mapped = err.code && opts?.codeMap?.[err.code];
      if (mapped) {
        toast.error(mapped);
        return;
      }
      if (err.message && err.message.trim() !== '') {
        toast.error(err.message);
        return;
      }
    }
    toast.error(opts?.fallback ?? 'Ocurrió un error inesperado');
  } catch {
    // Never propagate — this helper is purely a side-effect.
  }
}
