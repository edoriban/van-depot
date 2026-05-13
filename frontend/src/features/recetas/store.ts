/**
 * features/recetas/store.ts — screen-scoped Zustand store for the
 * `/recetas` LIST page AND `/recetas/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) and
 * §7 (Migration pattern — codified by the pilot SDD `frontend-migration`,
 * applied verbatim by productos + almacenes).
 *
 * Design `sdd/frontend-migration-recetas/design` §2.3 LOCKED DECISION:
 * ONE store, TWO slices (LIST + DETAIL) mirroring the work-orders + productos
 * + almacenes precedent. Sibling `resetList()` / `resetDetail()` actions plus
 * a whole-store `reset()`. Back-button navigation between list ↔ detail MUST
 * preserve the other slice.
 *
 * **PR-9 (this commit)** populates the LIST slice. The DETAIL slice is
 * staged as a documented TODO block — `initialDetailSlice` is intentionally
 * empty and `resetDetail()` is a no-op. **PR-10** will fill the DETAIL slice
 * per design §2.2 (localItems + hasChanges + edit/add-item drafts +
 * dispatch flag).
 *
 * Per FS-2.2 the consuming routes mount their slice's cleanup effect:
 *
 *   // list route (recetas/page.tsx)
 *   useEffect(() => () => useRecetasScreenStore.getState().resetList(), []);
 *
 *   // detail route (recetas/[id]/page.tsx) — PR-10
 *   useEffect(() => () => useRecetasScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Recipe } from '@/types';

// --- LIST slice — recipe meta draft -------------------------------------

/**
 * Recipe create form draft. Both fields are kept as strings (the controlled
 * `<Input>` + `<Textarea>` elements own string values). Validation happens
 * at `recipeFormSchema.safeParse` time inside the dialog component.
 */
export interface RecipeFormDraft {
  name: string;
  description: string;
}

const initialListDraft: RecipeFormDraft = {
  name: '',
  description: '',
};

// --- LIST slice initial state -------------------------------------------

const initialListSlice = {
  // 1-indexed page; default 1. recetas has NO URL state today (no
  // useSearchParams) — pagination is purely client-side, mirroring the
  // legacy `page` useState. Preserved per spec STRUCT-7.
  listPage: 1 as number,

  // Create dialog state.
  listFormOpen: false as boolean,
  listDraft: initialListDraft,
  listIsSaving: false as boolean,

  // Delete dialog state.
  deleteTargetRecipe: null as Recipe | null,
  listIsDeleting: false as boolean,
};

// --- DETAIL slice initial state -----------------------------------------
// TODO(PR-10 / frontend-migration-recetas Phase E): populate the DETAIL
// slice per design §2.2. The DETAIL slice will own:
//   - detailRecipeId, localItems, hasChanges, detailIsSaving
//   - editOpen + editDraft (RecipeMetaDraft)
//   - addItemOpen + addItemDraft (AddItemDraft — productSearch, selectedProductId,
//     itemQuantity, itemNotes)
//   - removeTargetItem
//   - dispatchWizardOpen
// Plus actions: setDetailRecipeId, loadDetail, openEditRecipeDialog,
// setEditField, closeEditRecipeDialog, openAddItemDialog, setAddItemField,
// closeAddItemDialog, appendLocalItem, removeLocalItem, setRemoveTargetItem,
// setDispatchWizardOpen, setHasChanges, setDetailSaving.
// `resetDetail()` clears the entire detail slice; whole-store `reset()`
// resets both slices.
const initialDetailSlice = {
  // Intentionally empty in PR-9; populated in PR-10.
};

// --- Store --------------------------------------------------------------

interface RecetasScreenState {
  // LIST slice fields.
  listPage: number;
  listFormOpen: boolean;
  listDraft: RecipeFormDraft;
  listIsSaving: boolean;
  deleteTargetRecipe: Recipe | null;
  listIsDeleting: boolean;

  // LIST slice actions.
  setListPage: (page: number) => void;
  setListFormField: <K extends keyof RecipeFormDraft>(
    key: K,
    value: RecipeFormDraft[K],
  ) => void;
  openCreateRecipe: () => void;
  closeRecipeDialog: () => void;
  setRecipeSaving: (saving: boolean) => void;
  setDeleteTargetRecipe: (recipe: Recipe | null) => void;
  setRecipeDeleting: (deleting: boolean) => void;

  // Per-slice + whole-store resets per design §2.3.
  resetList: () => void;
  resetDetail: () => void;
  reset: () => void;
}

const initialState = {
  ...initialListSlice,
  ...initialDetailSlice,
};

export const useRecetasScreenStore = create<RecetasScreenState>()(
  devtools(
    (set) => ({
      ...initialState,

      // --- LIST slice actions -------------------------------------------
      setListPage: (listPage) => set({ listPage }),
      setListFormField: (key, value) =>
        set((s) => ({ listDraft: { ...s.listDraft, [key]: value } })),
      openCreateRecipe: () =>
        set({
          listFormOpen: true,
          listDraft: initialListDraft,
        }),
      closeRecipeDialog: () => set({ listFormOpen: false }),
      setRecipeSaving: (listIsSaving) => set({ listIsSaving }),
      setDeleteTargetRecipe: (deleteTargetRecipe) =>
        set({ deleteTargetRecipe }),
      setRecipeDeleting: (listIsDeleting) => set({ listIsDeleting }),

      // --- Resets (slice-scoped) ----------------------------------------
      resetList: () => set({ ...initialListSlice }),
      // PR-10: replace with a real reset of the DETAIL slice fields.
      resetDetail: () => set({ ...initialDetailSlice }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: 'useRecetasScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
