/**
 * lib/hooks/use-resource-list.ts — canonical list/lookup SWR primitive.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR).
 */
'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { unwrapList } from '@/lib/api';

export interface UseResourceListResult<T> {
  data: T[];
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<T[] | undefined>;
}

/**
 * Fetch a list/lookup resource with SWR semantics (request dedup,
 * stale-while-revalidate, focus revalidation per `SWRProvider`).
 *
 * - `path`: API path relative to `NEXT_PUBLIC_API_URL`. Pass `null`
 *   to disable the hook (no fetch, returns `[]`).
 * - `query`: optional querystring — folded into the SWR cache key so
 *   two consumers with the same params share one network request.
 * - `swrOptions`: passthrough to underlying SWR call.
 *
 * Returns `{ data, isLoading, error, refresh }`. `refresh()` is a thin
 * wrapper over SWR `mutate(undefined, { revalidate: true })`.
 *
 * @example
 *   const { data: products, isLoading } =
 *     useResourceList<Product>('/products');
 */
export function useResourceList<T>(
  path: string | null,
  query?: Record<string, string | number | boolean | undefined>,
  swrOptions?: SWRConfiguration,
): UseResourceListResult<T> {
  const key = path === null ? null : buildKey(path, query);
  // Pass `null` as the fetcher so SWR resolves the global fetcher from
  // the `SWRProvider` context (auth-aware). When `key` is `null`, SWR
  // skips the fetch entirely and `data`/`error` stay `undefined`.
  const swr = useSWR<unknown>(key, null, swrOptions);

  const data = swr.data === undefined ? [] : unwrapList<T>(swr.data);
  const isLoading = path !== null && swr.isLoading;

  const refresh = async (): Promise<T[] | undefined> => {
    if (path === null) return undefined;
    const next = await swr.mutate(undefined, { revalidate: true });
    return next === undefined ? undefined : unwrapList<T>(next);
  };

  return { data, isLoading, error: swr.error, refresh };
}

function buildKey(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
