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
 * will mount `resetDetail` on unmount (added in PR-4).
 *
 * PR-3 (this commit) ships the LIST slice; the DETAIL slice is reserved as a
 * documented TODO below for PR-4 (`sdd/frontend-migration` tasks E2-E10) to
 * fill in (issueDialogOpen, cancelDialogOpen, cancelReason, missingMaterials,
 * isMutating). Do NOT add detail-slice fields here yet — PR-4 owns that.
 *
 * Per FS-2.2 the consuming list route MUST mount:
 *
 *   useEffect(() => () => useWorkOrdersScreenStore.getState().resetList(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { RecipeDetail } from '@/types';

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

// --- DETAIL slice (reserved for PR-4) -------------------------------------
//
// TODO(PR-4 / sdd-apply E2): extend `WorkOrdersScreenState` with the detail
// slice. The locked shape is:
//
//   issueDialogOpen: boolean;
//   cancelDialogOpen: boolean;
//   cancelReason: string;
//   missingMaterials: MissingMaterial[];    // INSUFFICIENT_WORK_ORDER_STOCK rows
//   isMutating: boolean;
//
// plus actions: openIssueDialog, closeIssueDialog, openCancelDialog,
// closeCancelDialog, setCancelReason, setMissingMaterials, setMutating,
// resetDetail.
//
// `resetDetail()` MUST return only the detail slice to its initial values
// WITHOUT touching the list slice (so list filters / create dialog state
// survive a quick back-button → forward-button roundtrip through detail).

// --- Store ----------------------------------------------------------------

interface WorkOrdersScreenState {
  // LIST slice fields.
  formOpen: boolean;
  draft: WorkOrderCreateDraft;
  selectedRecipe: RecipeDetail | null;

  // LIST slice actions.
  setFormField: <K extends keyof WorkOrderCreateDraft>(
    key: K,
    value: WorkOrderCreateDraft[K],
  ) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
  setSelectedRecipe: (recipe: RecipeDetail | null) => void;

  // Per-slice + whole-store resets per design §2.4.
  resetList: () => void;
  reset: () => void;
}

const initialState = {
  ...initialListSlice,
};

export const useWorkOrdersScreenStore = create<WorkOrdersScreenState>()(
  devtools(
    (set) => ({
      ...initialState,
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
      resetList: () => set({ ...initialListSlice }),
      reset: () => set(initialState),
    }),
    {
      name: 'useWorkOrdersScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
