/**
 * lib/hooks/use-picking-actions.ts — picking mutation orchestrator.
 *
 * Exposes 10 mutation wrappers backed by `api.*`, each instrumented with:
 *   - Write-through cache update on success: `mutate('/picking-lists/{id}', res, { revalidate: false })`.
 *   - List-views invalidation: `mutate(predicate, undefined, { revalidate: true })`
 *     where the predicate matches `'/picking-lists'` and every `'/picking-lists?...'`
 *     filter key (so admin filter combos and "asignadas a mí" sub-tabs all converge).
 *   - 409 stale-state recovery (design §13): toast → mutate(detail) → invalidate
 *     list views → if the refetched status is no longer pickable, redirect to
 *     `/picking`. The 409 error is always surfaced via `surfaceApiError` and
 *     re-thrown so callers can dismiss inflight dialogs.
 *
 * Hook signature accepts `listId: string | null` (instead of splitting the
 * surface) — id-bound methods call `requireId()` which throws a developer
 * `Error` if invoked with a null id, mirroring how `useResourceList(path: null, ...)`
 * surfaces the same constraint.
 *
 * @example
 *   const actions = usePickingActions(listId);
 *   try {
 *     await actions.release();
 *     closeDialog();
 *   } catch {
 *     // wrap() already surfaced a toast; just keep the dialog open.
 *   }
 */
'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { mutate as globalMutate } from 'swr';
import { toast } from 'sonner';

import { api, isApiError, type ApiError } from '@/lib/api-mutations';
import { surfaceApiError } from '@/lib/api';
import { buildPickingCodeMap } from '@/lib/picking-error-codes';
import type {
  CancelRequest,
  CreatePickingListRequest,
  PickingListDetailResponse,
  PickingListStatus,
  RecordPickRequest,
  UpdatePickingListRequest,
} from '@/types';

/** Statuses from which the operator can still act on a list. */
const PICKABLE_STATUSES: ReadonlySet<PickingListStatus> = new Set([
  'in_progress',
]);

const LIST_KEY = '/picking-lists';

/** Write-through cache update for the detail key. */
function applyDetail(
  listId: string,
  res: PickingListDetailResponse,
): Promise<PickingListDetailResponse | undefined> {
  return globalMutate(`${LIST_KEY}/${listId}`, res, { revalidate: false });
}

/** Invalidate every list-view filter combination. */
function invalidateListViews(): Promise<unknown> {
  return globalMutate(
    (key) =>
      typeof key === 'string' &&
      (key === LIST_KEY || key.startsWith(`${LIST_KEY}?`)),
    undefined,
    { revalidate: true },
  );
}

export interface UsePickingActionsApi {
  createDraft: (
    payload: CreatePickingListRequest,
  ) => Promise<PickingListDetailResponse>;
  updateDraft: (
    payload: UpdatePickingListRequest,
  ) => Promise<PickingListDetailResponse>;
  softDelete: () => Promise<void>;
  release: () => Promise<PickingListDetailResponse>;
  assign: (userId: string) => Promise<PickingListDetailResponse>;
  start: () => Promise<PickingListDetailResponse>;
  recordPick: (
    lineId: string,
    payload: RecordPickRequest,
  ) => Promise<PickingListDetailResponse>;
  skipLine: (
    lineId: string,
    reason?: string,
  ) => Promise<PickingListDetailResponse>;
  complete: () => Promise<PickingListDetailResponse>;
  cancel: (reason?: string) => Promise<PickingListDetailResponse>;
}

export function usePickingActions(listId: string | null): UsePickingActionsApi {
  const router = useRouter();

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const apiErr = isApiError(err) ? err : undefined;

        if (apiErr && apiErr.status === 409 && listId) {
          toast.info('La lista cambió de estado — actualizando.');
          // Refetch the detail; swallow inner refetch errors so the original
          // 409 surface still fires its Spanish toast even if the refetch
          // fails (network blip).
          let refreshed: PickingListDetailResponse | undefined;
          try {
            refreshed = (await globalMutate(
              `${LIST_KEY}/${listId}`,
            )) as PickingListDetailResponse | undefined;
          } catch {
            // ignore — fall through to surfaceApiError
          }
          try {
            await invalidateListViews();
          } catch {
            // ignore
          }
          if (
            refreshed?.list?.status &&
            !PICKABLE_STATUSES.has(refreshed.list.status)
          ) {
            router.push('/picking');
          }
        }

        surfaceApiError(err, { codeMap: buildPickingCodeMap(apiErr) });
        throw err;
      }
    },
    [listId, router],
  );

  const requireId = useCallback((): string => {
    if (!listId) {
      throw new Error(
        'usePickingActions: this mutation requires a non-null listId',
      );
    }
    return listId;
  }, [listId]);

  return useMemo<UsePickingActionsApi>(
    () => ({
      createDraft: (payload) =>
        wrap(async () => {
          const res = await api.post<PickingListDetailResponse>(
            '/picking-lists',
            payload,
          );
          // Seed the detail cache so a follow-up navigation hydrates instantly.
          if (res.list?.id) {
            await applyDetail(res.list.id, res);
          }
          await invalidateListViews();
          return res;
        }),

      updateDraft: (payload) =>
        wrap(async () => {
          const id = requireId();
          const res = await api.patch<PickingListDetailResponse>(
            `/picking-lists/${id}`,
            payload,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      softDelete: () =>
        wrap(async () => {
          const id = requireId();
          await api.del<void>(`/picking-lists/${id}`);
          // Evict the detail cache entry — subsequent reads will refetch (and
          // get a 404, which the detail page handles per R1.2).
          await globalMutate(`${LIST_KEY}/${id}`, undefined, {
            revalidate: false,
          });
          await invalidateListViews();
        }),

      release: () =>
        wrap(async () => {
          const id = requireId();
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/release`,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      assign: (userId) =>
        wrap(async () => {
          const id = requireId();
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/assign`,
            { user_id: userId },
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      start: () =>
        wrap(async () => {
          const id = requireId();
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/start`,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      recordPick: (lineId, payload) =>
        wrap(async () => {
          const id = requireId();
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/lines/${lineId}/pick`,
            payload,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      skipLine: (lineId, reason) =>
        wrap(async () => {
          const id = requireId();
          // Wire DTO `SkipLineRequest.reason` is `Option<String>` → `string | null`.
          const body = { reason: reason ?? null };
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/lines/${lineId}/skip`,
            body,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      complete: () =>
        wrap(async () => {
          const id = requireId();
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/complete`,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),

      cancel: (reason) =>
        wrap(async () => {
          const id = requireId();
          const body: CancelRequest = { reason: reason ?? null };
          const res = await api.post<PickingListDetailResponse>(
            `/picking-lists/${id}/cancel`,
            body,
          );
          await applyDetail(id, res);
          await invalidateListViews();
          return res;
        }),
    }),
    [wrap, requireId],
  );
}

// Re-export so consumers can introspect the recovery branch in tests if needed.
export { PICKABLE_STATUSES };
export type { ApiError };
