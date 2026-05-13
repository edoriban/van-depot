/**
 * lib/hooks/use-product-movements.ts — paginated movement history for the
 * product detail page (`/productos/[id]`).
 *
 * See `frontend/src/CONVENTIONS.md` §3 (Data fetching with SWR) and
 * `sdd/frontend-migration-productos/design` §4.5 + spec PROD-DETAIL-INV-4.
 *
 * Pagination shape LOCKED at page+append (NOT cursor) to mirror today's
 * `fetchMovements(p, append)` behavior. Internally uses `useSWRInfinite`
 * which is the canonical SWR primitive for accumulated pages — each page's
 * cache key is `/movements?product_id={id}&per_page=20&page={n}&start_date={iso}`.
 *
 * Consumers see only `{ movements, total, hasMore, loadMore }`. The hook
 * owns the page counter — there is no `useState` cascade in the consumer.
 *
 * @example
 *   const { movements, total, hasMore, loadMore, isLoading } =
 *     useProductMovements(productId, { perPage: 20, startDate });
 */
'use client';

import useSWRInfinite from 'swr/infinite';
import { api } from '@/lib/api-mutations';
import type { MovementType, PaginatedResponse } from '@/types';

export interface MovementRecord {
  id: string;
  product_id: string;
  from_location_id?: string | null;
  to_location_id?: string | null;
  quantity: number;
  movement_type: MovementType;
  user_id: string;
  reference?: string | null;
  notes?: string | null;
  supplier_id?: string | null;
  movement_reason?: string | null;
  created_at: string;
}

export interface UseProductMovementsOptions {
  /** Page size — defaults to 20 to match the current detail page. */
  perPage?: number;
  /** ISO timestamp of the lower bound (6-month window in current code). */
  startDate: string;
}

export interface UseProductMovementsResult {
  movements: MovementRecord[];
  total: number;
  isLoading: boolean;
  page: number;
  hasMore: boolean;
  loadMore: () => void;
}

export function useProductMovements(
  productId: string | null | undefined,
  opts: UseProductMovementsOptions,
): UseProductMovementsResult {
  const perPage = opts.perPage ?? 20;

  const getKey = (pageIndex: number, previousPageData: PaginatedResponse<MovementRecord> | null) => {
    if (!productId) return null;
    // Stop paging when the previous page returned fewer rows than requested.
    if (previousPageData && previousPageData.data.length < perPage) return null;
    const page = pageIndex + 1;
    return `/movements?product_id=${productId}&per_page=${perPage}&page=${page}&start_date=${encodeURIComponent(opts.startDate)}`;
  };

  const swr = useSWRInfinite<PaginatedResponse<MovementRecord>>(getKey, (k: string) =>
    api.get<PaginatedResponse<MovementRecord>>(k),
  );

  const pages = swr.data ?? [];
  const movements = pages.flatMap((p) => p.data);
  const total = pages.length > 0 ? pages[pages.length - 1].total : 0;
  const page = swr.size;
  const hasMore = movements.length < total;

  const loadMore = () => {
    void swr.setSize((s) => s + 1);
  };

  return {
    movements,
    total,
    isLoading: swr.isLoading,
    page,
    hasMore,
    loadMore,
  };
}
