/**
 * features/almacenes/store.ts — screen-scoped Zustand store for the
 * `/almacenes` LIST page AND `/almacenes/[id]` DETAIL page.
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
 * **PR-7** shipped the LIST slice. **PR-8 (this commit)** populates the
 * DETAIL slice per design §2.2 (11 fields + actions) and makes
 * `resetDetail()` a real reset.
 *
 * Per FS-2.2 the consuming routes mount their slice's cleanup effect:
 *
 *   // list route (almacenes/page.tsx)
 *   useEffect(() => () => useAlmacenesScreenStore.getState().resetList(), []);
 *
 *   // detail route (almacenes/[id]/page.tsx)
 *   useEffect(() => () => useAlmacenesScreenStore.getState().resetDetail(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Location, LocationType, Warehouse, ZoneHealth } from '@/types';

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

// --- DETAIL slice — location form draft ---------------------------------

const LOCATION_TYPES_DEFAULT: LocationType[] = [
  'zone',
  'rack',
  'shelf',
  'position',
  'bin',
];

/**
 * Location create/edit draft. Mirrors the legacy `LocationsTab` inline form
 * state: name, type, parent_id (empty string = none), allowedTypes derived
 * from the parent's `CHILD_TYPES` lookup.
 *
 * `allowedTypes` lives in the draft (rather than being recomputed at render
 * time) so the parent-cascade callback in `location-create-edit-dialog.tsx`
 * can re-derive it without recomputing during render.
 */
export interface LocationFormDraft {
  name: string;
  locationType: LocationType;
  parentId: string;
  allowedTypes: LocationType[];
}

const initialLocationDraft: LocationFormDraft = {
  name: '',
  locationType: 'zone',
  parentId: '',
  allowedTypes: LOCATION_TYPES_DEFAULT,
};

// --- DETAIL slice initial state -----------------------------------------

const initialDetailSlice = {
  // Current route param; cleared on resetDetail. The page calls
  // `setDetailWarehouseId(id)` from a `useEffect([id])` so cross-warehouse
  // navigations don't leak tree state.
  detailWarehouseId: null as string | null,

  // Tree expand state — persists across tab switches within the same
  // warehouse, but `setDetailWarehouseId` resets it when the id changes.
  expandedLocationIds: new Set<string>() as Set<string>,

  // Location dialog state.
  locationFormOpen: false as boolean,
  editingLocation: null as Location | null,
  locationDraft: initialLocationDraft,
  locationIsSaving: false as boolean,

  // Location delete state.
  deleteTargetLocation: null as Location | null,
  locationIsDeleting: false as boolean,

  // Map tab — current zone selection.
  selectedZone: null as ZoneHealth | null,

  // Per-tab pagination cursors (preserved when switching tabs).
  inventoryPage: 1 as number,
  movementsPage: 1 as number,
};

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

  // DETAIL slice fields.
  detailWarehouseId: string | null;
  expandedLocationIds: Set<string>;
  locationFormOpen: boolean;
  editingLocation: Location | null;
  locationDraft: LocationFormDraft;
  locationIsSaving: boolean;
  deleteTargetLocation: Location | null;
  locationIsDeleting: boolean;
  selectedZone: ZoneHealth | null;
  inventoryPage: number;
  movementsPage: number;

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

  // DETAIL slice actions.
  setDetailWarehouseId: (id: string | null) => void;
  toggleExpandedLocation: (id: string) => void;
  expandAllLocations: (ids: string[]) => void;
  collapseAllLocations: () => void;
  setLocationFormField: <K extends keyof LocationFormDraft>(
    key: K,
    value: LocationFormDraft[K],
  ) => void;
  openCreateLocation: (
    parentId: string | null,
    parentType: LocationType | null,
    allowedTypes: LocationType[],
  ) => void;
  openEditLocation: (
    location: Location,
    allowedTypes: LocationType[],
  ) => void;
  closeLocationDialog: () => void;
  setLocationSaving: (saving: boolean) => void;
  setDeleteTargetLocation: (location: Location | null) => void;
  setLocationDeleting: (deleting: boolean) => void;
  setSelectedZone: (zone: ZoneHealth | null) => void;
  setInventoryPage: (page: number) => void;
  setMovementsPage: (page: number) => void;

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

/**
 * Build a `LocationFormDraft` from an existing location (edit mode). The
 * caller passes `allowedTypes` because it depends on the parent lookup
 * (computed against the latest `allLocations` snapshot at call site).
 */
function draftFromLocation(
  location: Location,
  allowedTypes: LocationType[],
): LocationFormDraft {
  return {
    name: location.name,
    locationType: location.location_type,
    parentId: location.parent_id ?? '',
    allowedTypes:
      allowedTypes.length > 0 ? allowedTypes : LOCATION_TYPES_DEFAULT,
  };
}

export const useAlmacenesScreenStore = create<AlmacenesScreenState>()(
  devtools(
    (set, get) => ({
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

      // --- DETAIL slice actions -----------------------------------------
      setDetailWarehouseId: (id) => {
        const previous = get().detailWarehouseId;
        if (previous === id) return;
        // Cross-warehouse navigation: clear expand set + selected zone +
        // per-tab pagination + any in-flight dialogs so state from
        // warehouse A does not leak to warehouse B (design risk R2).
        set({
          detailWarehouseId: id,
          expandedLocationIds: new Set<string>(),
          locationFormOpen: false,
          editingLocation: null,
          locationDraft: initialLocationDraft,
          locationIsSaving: false,
          deleteTargetLocation: null,
          locationIsDeleting: false,
          selectedZone: null,
          inventoryPage: 1,
          movementsPage: 1,
        });
      },
      toggleExpandedLocation: (id) =>
        set((s) => {
          const next = new Set(s.expandedLocationIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { expandedLocationIds: next };
        }),
      expandAllLocations: (ids) =>
        set({ expandedLocationIds: new Set(ids) }),
      collapseAllLocations: () =>
        set({ expandedLocationIds: new Set<string>() }),
      setLocationFormField: (key, value) =>
        set((s) => ({
          locationDraft: { ...s.locationDraft, [key]: value },
        })),
      openCreateLocation: (parentId, parentType, allowedTypes) => {
        const safeAllowed =
          allowedTypes.length > 0 ? allowedTypes : LOCATION_TYPES_DEFAULT;
        // Default type when creating from the root toolbar is `zone`;
        // when creating from a parent it is the parent's first allowed
        // child type (matches legacy openCreateDialog behavior).
        const defaultType: LocationType = parentType
          ? safeAllowed[0]
          : 'zone';
        set({
          locationFormOpen: true,
          editingLocation: null,
          locationDraft: {
            name: '',
            locationType: defaultType,
            parentId: parentId ?? '',
            allowedTypes: safeAllowed,
          },
        });
      },
      openEditLocation: (location, allowedTypes) =>
        set({
          locationFormOpen: true,
          editingLocation: location,
          locationDraft: draftFromLocation(location, allowedTypes),
        }),
      closeLocationDialog: () => set({ locationFormOpen: false }),
      setLocationSaving: (locationIsSaving) => set({ locationIsSaving }),
      setDeleteTargetLocation: (deleteTargetLocation) =>
        set({ deleteTargetLocation }),
      setLocationDeleting: (locationIsDeleting) =>
        set({ locationIsDeleting }),
      setSelectedZone: (selectedZone) => set({ selectedZone }),
      setInventoryPage: (inventoryPage) => set({ inventoryPage }),
      setMovementsPage: (movementsPage) => set({ movementsPage }),

      // --- Resets (slice-scoped) ----------------------------------------
      resetList: () => set({ ...initialListSlice }),
      resetDetail: () =>
        set({
          ...initialDetailSlice,
          // Always allocate a fresh Set instance (reusing the module-level
          // initialDetailSlice.expandedLocationIds across mounts would
          // share mutable state).
          expandedLocationIds: new Set<string>(),
        }),
      reset: () =>
        set({
          ...initialState,
          expandedLocationIds: new Set<string>(),
        }),
    }),
    {
      name: 'useAlmacenesScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
