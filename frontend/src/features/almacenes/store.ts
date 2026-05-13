/**
 * features/almacenes/store.ts — screen-scoped Zustand store for the
 * `/almacenes` LIST page (and the future `/almacenes/[id]` DETAIL page).
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) and
 * §7.1 (Migration pattern — codified by the pilot SDD `frontend-migration`,
 * applied verbatim by productos).
 *
 * Design `sdd/frontend-migration-almacenes/design` §2.3 LOCKED DECISION:
 * ONE store, TWO slices (LIST + DETAIL) mirroring the work-orders + productos
 * precedent (`useWorkOrdersScreenStore`, `useProductosScreenStore`). Sibling
 * `resetList()` / `resetDetail()` actions plus a whole-store `reset()`.
 * Back-button navigation between list ↔ detail MUST preserve the other slice.
 *
 * **PR-7 (this commit)** ships the LIST slice fully populated (per design
 * §2.1). The DETAIL slice is RESERVED as an empty initial-state block + a
 * no-op `resetDetail()` placeholder so PR-8 can fill it in without breaking
 * the store shape consumers depend on.
 *
 * Per FS-2.2 the consuming routes mount their slice's cleanup effect:
 *
 *   // list route (almacenes/page.tsx)
 *   useEffect(() => () => useAlmacenesScreenStore.getState().resetList(), []);
 *
 *   // detail route (almacenes/[id]/page.tsx) — to be added by PR-8
 *   useEffect(() => () => useAlmacenesScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Warehouse } from '@/types';

// --- LIST slice — warehouse create/edit draft ----------------------------

/**
 * Warehouse create/edit draft. Both fields are kept as strings (the
 * controlled `<Input>` elements own string values). Validation happens at
 * `warehouseFormSchema.safeParse` time inside the dialog component.
 */
export interface WarehouseFormDraft {
  name: string;
  address: string;
}

const initialListDraft: WarehouseFormDraft = {
  name: '',
  address: '',
};

// --- LIST slice initial state -------------------------------------------

const initialListSlice = {
  // Client-side filter (NOT URL-bound per ALM-LIST-INV-3).
  listSearch: '' as string,
  // 1-indexed page; default 1. Mirrors the URL-less pagination invariant
  // (search/page are NOT URL-bound today).
  listPage: 1 as number,

  // Warehouse dialog state.
  listFormOpen: false as boolean,
  editingWarehouse: null as Warehouse | null,
  listDraft: initialListDraft,
  listIsSaving: false as boolean,

  // Delete dialog state.
  deleteTargetWarehouse: null as Warehouse | null,
  listIsDeleting: false as boolean,
};

// --- DETAIL slice — RESERVED slot (PR-8 will populate) ------------------

/**
 * DETAIL slice initial state. PR-7 ships an empty placeholder — PR-8 will
 * extend this block with the fields enumerated in design §2.2
 * (`detailWarehouseId`, `expandedLocationIds`, `locationFormOpen`,
 * `editingLocation`, `locationDraft`, `locationIsSaving`,
 * `deleteTargetLocation`, `locationIsDeleting`, `selectedZone`,
 * `inventoryPage`, `movementsPage`).
 *
 * The placeholder keeps the store shape stable: `resetDetail()` is a no-op
 * today; PR-8 makes it real without breaking `useAlmacenesScreenStore.reset()`
 * callers.
 */
const initialDetailSlice = {};

// --- Store --------------------------------------------------------------

interface AlmacenesScreenState {
  // LIST slice fields.
  listSearch: string;
  listPage: number;
  listFormOpen: boolean;
  editingWarehouse: Warehouse | null;
  listDraft: WarehouseFormDraft;
  listIsSaving: boolean;
  deleteTargetWarehouse: Warehouse | null;
  listIsDeleting: boolean;

  // LIST slice actions.
  setListSearch: (value: string) => void;
  setListPage: (page: number) => void;
  setListFormField: <K extends keyof WarehouseFormDraft>(
    key: K,
    value: WarehouseFormDraft[K],
  ) => void;
  openCreateWarehouse: () => void;
  openEditWarehouse: (warehouse: Warehouse) => void;
  closeWarehouseDialog: () => void;
  setWarehouseSaving: (saving: boolean) => void;
  setDeleteTargetWarehouse: (warehouse: Warehouse | null) => void;
  setWarehouseDeleting: (deleting: boolean) => void;

  // Per-slice + whole-store resets per design §2.3.
  resetList: () => void;
  resetDetail: () => void;
  reset: () => void;
}

const initialState = {
  ...initialListSlice,
  ...initialDetailSlice,
};

/**
 * Build a `WarehouseFormDraft` from an existing warehouse (edit mode). Used
 * by `openEditWarehouse` below. Coerces nullable address to an empty string
 * (controlled-input contract).
 */
function draftFromWarehouse(warehouse: Warehouse): WarehouseFormDraft {
  return {
    name: warehouse.name,
    address: warehouse.address ?? '',
  };
}

export const useAlmacenesScreenStore = create<AlmacenesScreenState>()(
  devtools(
    (set) => ({
      ...initialState,

      // --- LIST slice actions -------------------------------------------
      setListSearch: (listSearch) => set({ listSearch }),
      setListPage: (listPage) => set({ listPage }),
      setListFormField: (key, value) =>
        set((s) => ({ listDraft: { ...s.listDraft, [key]: value } })),
      openCreateWarehouse: () =>
        set({
          listFormOpen: true,
          editingWarehouse: null,
          listDraft: initialListDraft,
        }),
      openEditWarehouse: (warehouse) =>
        set({
          listFormOpen: true,
          editingWarehouse: warehouse,
          listDraft: draftFromWarehouse(warehouse),
        }),
      closeWarehouseDialog: () => set({ listFormOpen: false }),
      setWarehouseSaving: (listIsSaving) => set({ listIsSaving }),
      setDeleteTargetWarehouse: (deleteTargetWarehouse) =>
        set({ deleteTargetWarehouse }),
      setWarehouseDeleting: (listIsDeleting) => set({ listIsDeleting }),

      // --- Resets (slice-scoped) ----------------------------------------
      resetList: () => set({ ...initialListSlice }),
      // PR-7: DETAIL slice is reserved; resetDetail is a no-op until PR-8
      // populates the slice.
      resetDetail: () => set({ ...initialDetailSlice }),
      reset: () => set(initialState),
    }),
    {
      name: 'useAlmacenesScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
