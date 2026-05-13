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
 * **PR-9** populated the LIST slice; **PR-10 (this commit)** fills the
 * DETAIL slice per design §2.2 — `localItems` + `hasChanges` are the novel
 * piece (distinct from productos+almacenes immediate-mutation flow). The
 * `loadDetail` action is the SOLE entry point that initializes / clobbers
 * `localItems` (design §5.2 LOCKED).
 *
 * Per FS-2.2 the consuming routes mount their slice's cleanup effect:
 *
 *   // list route (recetas/page.tsx)
 *   useEffect(() => () => useRecetasScreenStore.getState().resetList(), []);
 *
 *   // detail route (recetas/[id]/page.tsx)
 *   useEffect(() => () => useRecetasScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Recipe, RecipeDetail, RecipeItem } from '@/types';

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

// --- DETAIL slice drafts ------------------------------------------------

/**
 * Recipe edit-meta dialog draft (pre-filled on open from `detail.recipe`).
 */
export interface RecipeMetaDraft {
  name: string;
  description: string;
}

const initialEditDraft: RecipeMetaDraft = {
  name: '',
  description: '',
};

/**
 * Add-item dialog draft (4 fields: search, picked product id, quantity,
 * notes). String quantity preserves the controlled `<Input type="number">`
 * empty-state semantics from the legacy code.
 */
export interface AddItemDraft {
  productSearch: string;
  selectedProductId: string;
  itemQuantity: string;
  itemNotes: string;
}

const initialAddItemDraft: AddItemDraft = {
  productSearch: '',
  selectedProductId: '',
  itemQuantity: '',
  itemNotes: '',
};

// --- DETAIL slice initial state -----------------------------------------

const initialDetailSlice = {
  // Currently-mounted detail recipe id. Cleared by `setDetailRecipeId(null)`
  // on navigation, and by `resetDetail()` on unmount.
  detailRecipeId: null as string | null,

  // Local mirror of the server's `detail.items`. Mutated by the add-item /
  // remove-item dialogs; sent back as a bulk PUT when the user clicks
  // `save-items-btn`. Re-seeded by `loadDetail(detail)` on every SWR success.
  localItems: [] as RecipeItem[],
  hasChanges: false as boolean,

  // Shared spinner flag (edit-meta dialog + save-items button).
  detailIsSaving: false as boolean,

  // Edit meta dialog.
  editOpen: false as boolean,
  editDraft: initialEditDraft,

  // Add item dialog.
  addItemOpen: false as boolean,
  addItemDraft: initialAddItemDraft,

  // Remove item confirm.
  removeTargetItem: null as RecipeItem | null,

  // Dispatch wizard launcher state. The wizard itself lives at the carved-out
  // `components/recipes/dispatch-wizard.tsx`; this flag only toggles its
  // `open` prop from the detail page shell.
  dispatchWizardOpen: false as boolean,
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

  // DETAIL slice fields.
  detailRecipeId: string | null;
  localItems: RecipeItem[];
  hasChanges: boolean;
  detailIsSaving: boolean;
  editOpen: boolean;
  editDraft: RecipeMetaDraft;
  addItemOpen: boolean;
  addItemDraft: AddItemDraft;
  removeTargetItem: RecipeItem | null;
  dispatchWizardOpen: boolean;

  // DETAIL slice actions.
  /**
   * Set the currently-mounted detail recipe id. R1 mitigation: when the id
   * changes, reset `localItems` + `hasChanges` so a back-then-forward
   * navigation between two recipes does NOT leak the previous one's draft.
   */
  setDetailRecipeId: (id: string | null) => void;
  /**
   * SOLE entry point that initializes `localItems` from the server (design
   * §5.2 LOCKED). Always clears `hasChanges` because the server is now the
   * new source of truth.
   */
  loadDetail: (detail: RecipeDetail) => void;
  setHasChanges: (changed: boolean) => void;
  setDetailSaving: (saving: boolean) => void;

  openEditRecipeDialog: (recipe: Recipe) => void;
  setEditField: <K extends keyof RecipeMetaDraft>(
    key: K,
    value: RecipeMetaDraft[K],
  ) => void;
  closeEditRecipeDialog: () => void;

  openAddItemDialog: () => void;
  setAddItemField: <K extends keyof AddItemDraft>(
    key: K,
    value: AddItemDraft[K],
  ) => void;
  closeAddItemDialog: () => void;
  /** Append a new local item AND set hasChanges=true. */
  appendLocalItem: (item: RecipeItem) => void;
  /** Drop the local item by id AND set hasChanges=true. */
  removeLocalItem: (itemId: string) => void;

  setRemoveTargetItem: (item: RecipeItem | null) => void;
  setDispatchWizardOpen: (open: boolean) => void;

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

      // --- DETAIL slice actions -----------------------------------------
      setDetailRecipeId: (detailRecipeId) =>
        set((s) =>
          s.detailRecipeId === detailRecipeId
            ? { detailRecipeId }
            : {
                detailRecipeId,
                // R1 mitigation: id change resets the local-items draft so
                // back-then-forward navigation never leaks across recipes.
                localItems: [],
                hasChanges: false,
              },
        ),
      loadDetail: (detail) =>
        set({
          localItems: detail.items,
          hasChanges: false,
        }),
      setHasChanges: (hasChanges) => set({ hasChanges }),
      setDetailSaving: (detailIsSaving) => set({ detailIsSaving }),

      openEditRecipeDialog: (recipe) =>
        set({
          editOpen: true,
          editDraft: {
            name: recipe.name,
            description: recipe.description ?? '',
          },
        }),
      setEditField: (key, value) =>
        set((s) => ({ editDraft: { ...s.editDraft, [key]: value } })),
      closeEditRecipeDialog: () => set({ editOpen: false }),

      openAddItemDialog: () =>
        set({
          addItemOpen: true,
          addItemDraft: initialAddItemDraft,
        }),
      setAddItemField: (key, value) =>
        set((s) => ({ addItemDraft: { ...s.addItemDraft, [key]: value } })),
      closeAddItemDialog: () => set({ addItemOpen: false }),
      appendLocalItem: (item) =>
        set((s) => ({
          localItems: [...s.localItems, item],
          hasChanges: true,
        })),
      removeLocalItem: (itemId) =>
        set((s) => ({
          localItems: s.localItems.filter((i) => i.id !== itemId),
          hasChanges: true,
        })),

      setRemoveTargetItem: (removeTargetItem) => set({ removeTargetItem }),
      setDispatchWizardOpen: (dispatchWizardOpen) =>
        set({ dispatchWizardOpen }),

      // --- Resets (slice-scoped) ----------------------------------------
      resetList: () => set({ ...initialListSlice }),
      resetDetail: () => set({ ...initialDetailSlice }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: 'useRecetasScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
