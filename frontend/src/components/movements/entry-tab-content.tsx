/**
 * components/movements/entry-tab-content.tsx — Entrada tab orchestrator.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Reads `entryMode` from the screen store and renders the matching sub-form
 * (simple / with-lot / with-PO). The mode toggle is sibling
 * `<EntryModeSelector>` (also store-backed) so no prop drilling.
 */
'use client';

import { useMovementsScreenStore } from '@/features/movements/store';
import type { Product, Supplier, Warehouse } from '@/types';

import { EntryForm } from './entry-form';
import { EntryModeSelector } from './entry-mode-selector';
import { EntryWithLotForm } from './entry-with-lot-form';
import { EntryWithPOForm } from './entry-with-po-form';

export interface EntryTabContentProps {
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onSuccess: () => void;
}

export function EntryTabContent({
  products,
  warehouses,
  suppliers,
  onSuccess,
}: EntryTabContentProps) {
  const entryMode = useMovementsScreenStore((s) => s.entryMode);

  return (
    <>
      <EntryModeSelector />
      {entryMode === 'simple' && (
        <EntryForm
          products={products}
          warehouses={warehouses}
          suppliers={suppliers}
          onSuccess={onSuccess}
        />
      )}
      {entryMode === 'with_lot' && <EntryWithLotForm onSuccess={onSuccess} />}
      {entryMode === 'with_po' && <EntryWithPOForm onSuccess={onSuccess} />}
    </>
  );
}
