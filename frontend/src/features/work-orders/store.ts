/**
 * features/work-orders/store.ts — screen-scoped Zustand store for the
 * `/ordenes-de-trabajo` list AND `/ordenes-de-trabajo/[id]` detail pages.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) and
 * §7.1 (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Design §2.4 LOCKED DECISION: ONE store, TWO slices (`list:` + `detail:`)
 * with sibling `resetList()` / `resetDetail()` actions plus a whole-store
 * `reset()`. The list route mounts `resetList` on unmount; the detail route
 * mounts `resetDetail` on unmount.
 *
 * PR-3 shipped the LIST slice; PR-4 (this commit) adds the DETAIL slice per
 * design §2.4 and spec WO-INV-3 (issue/cancel dialogs, insufficient-stock
 * surface, in-flight spinner). `resetList()` and `resetDetail()` touch ONLY
 * their own slice — quick back↔forward navigations between list and detail
 * MUST preserve the other slice's draft / dialog state.
 *
 * Per FS-2.2 the consuming routes MUST mount their slice's cleanup effect:
 *
 *   // list route
 *   useEffect(() => () => useWorkOrdersScreenStore.getState().resetList(), []);
 *
 *   // detail route
 *   useEffect(() => () => useWorkOrdersScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MissingMaterial, RecipeDetail } from '@/types';

// --- LIST slice -----------------------------------------------------------

/**
 * Create-dialog form draft. Numeric fields are kept as strings because the
 * controlled `<Input type="number">` elements own string values; coercion
 * happens at `safeParse` time via `z.coerce.number()`.
 */
export interface WorkOrderCreateDraft {
  recipeId: string;
  fgProductId: string;
  fgQuantity: string;
  warehouseId: string;
  workCenterId: string;
  notes: string;
}

const initialDraft: WorkOrderCreateDraft = {
  recipeId: '',
  fgProductId: '',
  fgQuantity: '1',
  warehouseId: '',
  workCenterId: '',
  notes: '',
};

const initialListSlice = {
  formOpen: false as boolean,
  draft: initialDraft,
  // Cached recipe detail for the BOM preview block under the recipe select.
  selectedRecipe: null as RecipeDetail | null,
};

// --- DETAIL slice ---------------------------------------------------------

const initialDetailSlice = {
  issueDialogOpen: false as boolean,
  cancelDialogOpen: false as boolean,
  cancelReason: '',
  // INSUFFICIENT_WORK_ORDER_STOCK rows surfaced inline on the detail page
  // (NEVER via toast — load-bearing per WO-INV-3). `null` = unsurfaced;
  // `[]` would mean surfaced-but-empty which is not a state we render.
  missingMaterials: null as MissingMaterial[] | null,
  isMutating: false as boolean,
};

// --- Store ----------------------------------------------------------------

interface WorkOrdersScreenState {
  // LIST slice fields.
  formOpen: boolean;
  draft: WorkOrderCreateDraft;
  selectedRecipe: RecipeDetail | null;

  // DETAIL slice fields.
  issueDialogOpen: boolean;
  cancelDialogOpen: boolean;
  cancelReason: string;
  missingMaterials: MissingMaterial[] | null;
  isMutating: boolean;

  // LIST slice actions.
  setFormField: <K extends keyof WorkOrderCreateDraft>(
    key: K,
    value: WorkOrderCreateDraft[K],
  ) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
  setSelectedRecipe: (recipe: RecipeDetail | null) => void;

  // DETAIL slice actions.
  openIssueDialog: () => void;
  closeIssueDialog: () => void;
  openCancelDialog: () => void;
  closeCancelDialog: () => void;
  setCancelReason: (reason: string) => void;
  setMissingMaterials: (rows: MissingMaterial[] | null) => void;
  setMutating: (mutating: boolean) => void;

  // Per-slice + whole-store resets per design §2.4.
  resetList: () => void;
  resetDetail: () => void;
  reset: () => void;
}

const initialState = {
  ...initialListSlice,
  ...initialDetailSlice,
};

export const useWorkOrdersScreenStore = create<WorkOrdersScreenState>()(
  devtools(
    (set) => ({
      ...initialState,
      // --- LIST actions ----------------------------------------------------
      setFormField: (key, value) =>
        set((s) => ({ draft: { ...s.draft, [key]: value } })),
      openCreateDialog: () =>
        // Reset draft + recipe preview when opening so the dialog always
        // starts from a clean slate (preserves PR-2 movements pattern).
        set({
          formOpen: true,
          draft: initialDraft,
          selectedRecipe: null,
        }),
      closeCreateDialog: () => set({ formOpen: false }),
      setSelectedRecipe: (selectedRecipe) => set({ selectedRecipe }),

      // --- DETAIL actions --------------------------------------------------
      openIssueDialog: () => set({ issueDialogOpen: true }),
      closeIssueDialog: () => set({ issueDialogOpen: false }),
      openCancelDialog: () => set({ cancelDialogOpen: true }),
      closeCancelDialog: () => set({ cancelDialogOpen: false }),
      setCancelReason: (cancelReason) => set({ cancelReason }),
      setMissingMaterials: (missingMaterials) => set({ missingMaterials }),
      setMutating: (isMutating) => set({ isMutating }),

      // --- Resets (slice-scoped) ------------------------------------------
      resetList: () => set({ ...initialListSlice }),
      resetDetail: () => set({ ...initialDetailSlice }),
      reset: () => set(initialState),
    }),
    {
      name: 'useWorkOrdersScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
