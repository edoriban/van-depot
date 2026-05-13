/**
 * features/productos/store.ts — screen-scoped Zustand store for the
 * `/productos` list AND `/productos/[id]` detail pages.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) and
 * §7.1 (Migration pattern — codified by the pilot SDD `frontend-migration`).
 *
 * Design `sdd/frontend-migration-productos/design` §2.3 LOCKED DECISION:
 * ONE store, TWO slices (LIST + DETAIL) mirroring the work-orders pilot
 * precedent (`useWorkOrdersScreenStore`). Sibling `resetList()` /
 * `resetDetail()` actions plus a whole-store `reset()`. Back-button
 * navigation between list ↔ detail MUST preserve the other slice.
 *
 * PR-5 (this commit) ships the LIST slice. The DETAIL slice is reserved as
 * a documented TODO for PR-6 — see the explicit comment block below.
 *
 * Per FS-2.2 the consuming routes mount their slice's cleanup effect:
 *
 *   // list route (productos/page.tsx)
 *   useEffect(() => () => useProductosScreenStore.getState().resetList(), []);
 *
 *   // detail route (productos/[id]/page.tsx — PR-6)
 *   useEffect(() => () => useProductosScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Category, Product, ProductClass, UnitType } from '@/types';

// --- LIST slice — product create/edit draft -------------------------------

/**
 * Product create/edit draft. Numeric fields are kept as strings because the
 * controlled `<Input type="number">` elements own string values; coercion
 * happens at `safeParse` time via `z.coerce.number()`.
 */
export interface ProductCreateDraft {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  unit: UnitType;
  productClass: ProductClass;
  hasExpiry: boolean;
  // Meaningful only when productClass === 'raw_material'. Auto-cleared by
  // setListFormField when productClass moves to a non-raw_material value.
  isManufactured: boolean;
  // One-shot warning shown when the user switches away from raw_material
  // while is_manufactured was true.
  manufacturedResetWarning: boolean;
  minStock: string;
  maxStock: string;
}

const initialListDraft: ProductCreateDraft = {
  name: '',
  sku: '',
  description: '',
  categoryId: '',
  unit: 'piece',
  productClass: 'raw_material',
  hasExpiry: false,
  isManufactured: false,
  manufacturedResetWarning: false,
  minStock: '0',
  maxStock: '',
};

// --- LIST slice — category create/edit draft ------------------------------

export interface CategoryFormDraft {
  name: string;
  parentId: string;
}

const initialCategoryDraft: CategoryFormDraft = {
  name: '',
  parentId: '',
};

// --- LIST slice initial state --------------------------------------------

const initialListSlice = {
  // product dialog state
  listFormOpen: false as boolean,
  editingProduct: null as Product | null,
  listDraft: initialListDraft,
  listIsSaving: false as boolean,
  deleteTargetProduct: null as Product | null,
  listIsDeleting: false as boolean,

  // category dialog state
  categoriesFormOpen: false as boolean,
  editingCategory: null as Category | null,
  categoriesDraft: initialCategoryDraft,
  categoriesIsSaving: false as boolean,
  deleteTargetCategory: null as Category | null,
  categoriesIsDeleting: false as boolean,
};

// --- DETAIL slice — RESERVED FOR PR-6 -------------------------------------
//
// TODO(PR-6 `frontend-migration-productos` detail): mirror PR-3 → PR-4
// progression in work-orders. The DETAIL slice will own `detailDraft`
// (9 fields), `detailIsSaving`, `reclassifyOpen`, `reclassifyChoice`,
// `reclassifyIsSaving`. See design §2.2 for the exact shape.
// `resetDetail()` below is a no-op placeholder for now so the page shell
// can already wire the FS-2.2 cleanup effect.

const initialDetailSlice = {
  // (intentionally empty — PR-6 fills this in)
};

// --- Store ----------------------------------------------------------------

interface ProductosScreenState {
  // LIST slice fields — product dialog.
  listFormOpen: boolean;
  editingProduct: Product | null;
  listDraft: ProductCreateDraft;
  listIsSaving: boolean;
  deleteTargetProduct: Product | null;
  listIsDeleting: boolean;

  // LIST slice fields — category dialog.
  categoriesFormOpen: boolean;
  editingCategory: Category | null;
  categoriesDraft: CategoryFormDraft;
  categoriesIsSaving: boolean;
  deleteTargetCategory: Category | null;
  categoriesIsDeleting: boolean;

  // LIST slice actions — product dialog.
  setListFormField: <K extends keyof ProductCreateDraft>(
    key: K,
    value: ProductCreateDraft[K],
  ) => void;
  openCreateProduct: () => void;
  openEditProduct: (product: Product) => void;
  closeProductDialog: () => void;
  setProductSaving: (saving: boolean) => void;
  setDeleteTargetProduct: (product: Product | null) => void;
  setProductDeleting: (deleting: boolean) => void;

  // LIST slice actions — category dialog.
  setCategoryFormField: <K extends keyof CategoryFormDraft>(
    key: K,
    value: CategoryFormDraft[K],
  ) => void;
  openCreateCategory: () => void;
  openEditCategory: (category: Category) => void;
  closeCategoryDialog: () => void;
  setCategorySaving: (saving: boolean) => void;
  setDeleteTargetCategory: (category: Category | null) => void;
  setCategoryDeleting: (deleting: boolean) => void;

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
 * Populate the product draft from an existing product (edit mode). Used by
 * `openEditProduct` below. Coerces numeric fields to controlled-input
 * strings.
 */
function draftFromProduct(product: Product): ProductCreateDraft {
  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? '',
    categoryId: product.category_id ?? '',
    unit: product.unit_of_measure,
    productClass: product.product_class,
    hasExpiry: product.has_expiry,
    isManufactured: product.is_manufactured,
    manufacturedResetWarning: false,
    minStock: String(product.min_stock),
    maxStock: product.max_stock != null ? String(product.max_stock) : '',
  };
}

function draftFromCategory(category: Category): CategoryFormDraft {
  return {
    name: category.name,
    parentId: category.parent_id ?? '',
  };
}

export const useProductosScreenStore = create<ProductosScreenState>()(
  devtools(
    (set) => ({
      ...initialState,

      // --- Product dialog actions ----------------------------------------
      setListFormField: (key, value) =>
        set((s) => {
          // Class-coupled cross-field reset must coalesce into ONE set() to
          // avoid `no-cascading-set-state`. Switching FROM raw_material
          // with is_manufactured=true clears the flag and surfaces a one-
          // shot warning banner. Switching TO tool_spare also forces
          // hasExpiry off (invariant: tool_spare never has expiry).
          if (key === 'productClass') {
            const next = value as ProductClass;
            const draft = { ...s.listDraft, productClass: next };
            if (next === 'tool_spare') {
              draft.hasExpiry = false;
            }
            if (next !== 'raw_material' && s.listDraft.isManufactured) {
              draft.isManufactured = false;
              draft.manufacturedResetWarning = true;
            } else {
              draft.manufacturedResetWarning = false;
            }
            return { listDraft: draft };
          }
          return { listDraft: { ...s.listDraft, [key]: value } };
        }),
      openCreateProduct: () =>
        set({
          listFormOpen: true,
          editingProduct: null,
          listDraft: initialListDraft,
        }),
      openEditProduct: (product) =>
        set({
          listFormOpen: true,
          editingProduct: product,
          listDraft: draftFromProduct(product),
        }),
      closeProductDialog: () => set({ listFormOpen: false }),
      setProductSaving: (listIsSaving) => set({ listIsSaving }),
      setDeleteTargetProduct: (deleteTargetProduct) =>
        set({ deleteTargetProduct }),
      setProductDeleting: (listIsDeleting) => set({ listIsDeleting }),

      // --- Category dialog actions ---------------------------------------
      setCategoryFormField: (key, value) =>
        set((s) => ({ categoriesDraft: { ...s.categoriesDraft, [key]: value } })),
      openCreateCategory: () =>
        set({
          categoriesFormOpen: true,
          editingCategory: null,
          categoriesDraft: initialCategoryDraft,
        }),
      openEditCategory: (category) =>
        set({
          categoriesFormOpen: true,
          editingCategory: category,
          categoriesDraft: draftFromCategory(category),
        }),
      closeCategoryDialog: () => set({ categoriesFormOpen: false }),
      setCategorySaving: (categoriesIsSaving) => set({ categoriesIsSaving }),
      setDeleteTargetCategory: (deleteTargetCategory) =>
        set({ deleteTargetCategory }),
      setCategoryDeleting: (categoriesIsDeleting) =>
        set({ categoriesIsDeleting }),

      // --- Resets (slice-scoped) -----------------------------------------
      resetList: () => set({ ...initialListSlice }),
      // PR-6 fills this in with real detail-slice reset semantics. For now
      // it is a no-op placeholder so the page shell can already mount its
      // FS-2.2 cleanup effect (idempotent).
      resetDetail: () => set({ ...initialDetailSlice }),
      reset: () => set(initialState),
    }),
    {
      name: 'useProductosScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
