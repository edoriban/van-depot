/**
 * features/movements/store.ts — screen-scoped Zustand store for the
 * `/movimientos` page.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (State management with Zustand) and
 * §7.1 (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Holds the six form drafts (entry-simple, entry-with-lot, entry-with-po,
 * exit, transfer, adjustment), the entry-mode wizard selection, and the
 * cached work-order chip for the breadcrumb filter.
 *
 * Tab / page / movement_type filter / work_order_id stay URL-driven via
 * `useSearchParams` and are NOT mirrored here.
 *
 * Per FS-2.2 the consuming route MUST mount:
 *
 *   useEffect(() => () => useMovementsScreenStore.getState().reset(), []);
 *
 * No `persist(...)` middleware is applied (FS-2.4). The devtools wrapper is
 * gated by `process.env.NODE_ENV !== 'production'` (FS-2.3).
 */
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { WorkOrder } from '@/types';

export type EntryMode = 'simple' | 'with_lot' | 'with_po';

export interface EntrySimpleDraft {
  productId: string;
  warehouseId: string;
  toLocationId: string;
  quantity: string;
  supplierId: string;
  reference: string;
  notes: string;
}

export interface EntryWithLotDraft {
  productId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  goodQuantity: string;
  defectQuantity: string;
  supplierId: string;
  batchDate: string;
  expirationDate: string;
  notes: string;
}

export interface EntryWithPoDraft {
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  goodQuantity: string;
  defectQuantity: string;
  batchDate: string;
  expirationDate: string;
  notes: string;
}

export interface ExitDraft {
  productId: string;
  warehouseId: string;
  fromLocationId: string;
  quantity: string;
  reference: string;
  notes: string;
}

export interface TransferDraft {
  productId: string;
  fromWarehouseId: string;
  fromLocationId: string;
  toWarehouseId: string;
  toLocationId: string;
  quantity: string;
  reference: string;
  notes: string;
}

export interface AdjustmentDraft {
  productId: string;
  warehouseId: string;
  locationId: string;
  newQuantity: string;
  reference: string;
  notes: string;
}

const initialEntrySimple: EntrySimpleDraft = {
  productId: '',
  warehouseId: '',
  toLocationId: '',
  quantity: '',
  supplierId: '',
  reference: '',
  notes: '',
};

const initialEntryWithLot: EntryWithLotDraft = {
  productId: '',
  warehouseId: '',
  locationId: '',
  lotNumber: '',
  goodQuantity: '',
  defectQuantity: '',
  supplierId: '',
  batchDate: '',
  expirationDate: '',
  notes: '',
};

const initialEntryWithPo: EntryWithPoDraft = {
  warehouseId: '',
  locationId: '',
  lotNumber: '',
  goodQuantity: '',
  defectQuantity: '',
  batchDate: '',
  expirationDate: '',
  notes: '',
};

const initialExit: ExitDraft = {
  productId: '',
  warehouseId: '',
  fromLocationId: '',
  quantity: '',
  reference: '',
  notes: '',
};

const initialTransfer: TransferDraft = {
  productId: '',
  fromWarehouseId: '',
  fromLocationId: '',
  toWarehouseId: '',
  toLocationId: '',
  quantity: '',
  reference: '',
  notes: '',
};

const initialAdjustment: AdjustmentDraft = {
  productId: '',
  warehouseId: '',
  locationId: '',
  newQuantity: '',
  reference: '',
  notes: '',
};

interface MovementsScreenState {
  // Entry wizard mode + drafts.
  entryMode: EntryMode;
  entrySimple: EntrySimpleDraft;
  entryWithLot: EntryWithLotDraft;
  entryWithPo: EntryWithPoDraft;

  // Other tab drafts.
  exit: ExitDraft;
  transfer: TransferDraft;
  adjustment: AdjustmentDraft;

  // Cached WO chip resolution for the deep-link breadcrumb.
  filterWorkOrder: WorkOrder | null;

  // Highlight-new-row flag for the history table (toggles for ~2s after a
  // submission succeeds, then resets to false).
  highlightNew: boolean;

  // Actions — granular per-field setters per FS-2.1 / §2.1.1.
  setEntryMode: (mode: EntryMode) => void;
  setEntrySimpleField: <K extends keyof EntrySimpleDraft>(key: K, value: EntrySimpleDraft[K]) => void;
  setEntryWithLotField: <K extends keyof EntryWithLotDraft>(key: K, value: EntryWithLotDraft[K]) => void;
  setEntryWithPoField: <K extends keyof EntryWithPoDraft>(key: K, value: EntryWithPoDraft[K]) => void;
  setExitField: <K extends keyof ExitDraft>(key: K, value: ExitDraft[K]) => void;
  setTransferField: <K extends keyof TransferDraft>(key: K, value: TransferDraft[K]) => void;
  setAdjustmentField: <K extends keyof AdjustmentDraft>(key: K, value: AdjustmentDraft[K]) => void;
  setFilterWorkOrder: (wo: WorkOrder | null) => void;
  setHighlightNew: (value: boolean) => void;

  // Per-tab resets — each form submits and clears INDEPENDENTLY.
  resetEntrySimple: () => void;
  resetEntryWithLot: () => void;
  resetEntryWithPo: () => void;
  resetExit: () => void;
  resetTransfer: () => void;
  resetAdjustment: () => void;

  // Whole-store reset (mounted on page unmount per FS-2.2).
  reset: () => void;
}

const initialState = {
  entryMode: 'simple' as EntryMode,
  entrySimple: initialEntrySimple,
  entryWithLot: initialEntryWithLot,
  entryWithPo: initialEntryWithPo,
  exit: initialExit,
  transfer: initialTransfer,
  adjustment: initialAdjustment,
  filterWorkOrder: null as WorkOrder | null,
  highlightNew: false,
};

export const useMovementsScreenStore = create<MovementsScreenState>()(
  devtools(
    (set) => ({
      ...initialState,
      setEntryMode: (entryMode) => set({ entryMode }),
      setEntrySimpleField: (key, value) =>
        set((s) => ({ entrySimple: { ...s.entrySimple, [key]: value } })),
      setEntryWithLotField: (key, value) =>
        set((s) => ({ entryWithLot: { ...s.entryWithLot, [key]: value } })),
      setEntryWithPoField: (key, value) =>
        set((s) => ({ entryWithPo: { ...s.entryWithPo, [key]: value } })),
      setExitField: (key, value) => set((s) => ({ exit: { ...s.exit, [key]: value } })),
      setTransferField: (key, value) =>
        set((s) => ({ transfer: { ...s.transfer, [key]: value } })),
      setAdjustmentField: (key, value) =>
        set((s) => ({ adjustment: { ...s.adjustment, [key]: value } })),
      setFilterWorkOrder: (filterWorkOrder) => set({ filterWorkOrder }),
      setHighlightNew: (highlightNew) => set({ highlightNew }),
      resetEntrySimple: () => set({ entrySimple: initialEntrySimple }),
      resetEntryWithLot: () => set({ entryWithLot: initialEntryWithLot }),
      resetEntryWithPo: () => set({ entryWithPo: initialEntryWithPo }),
      resetExit: () => set({ exit: initialExit }),
      resetTransfer: () => set({ transfer: initialTransfer }),
      resetAdjustment: () => set({ adjustment: initialAdjustment }),
      reset: () => set(initialState),
    }),
    {
      name: 'useMovementsScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
