/**
 * components/movements/entry-mode-selector.tsx — 3-option toggle for the
 * Entrada tab's sub-mode (simple / with lot / with PO).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern). Reads + writes
 * `entryMode` from `useMovementsScreenStore` so sibling sub-forms can switch
 * without prop drilling.
 */
'use client';

import { Button } from '@/components/ui/button';
import { useMovementsScreenStore, type EntryMode } from '@/features/movements/store';

const MODES: Array<{ mode: EntryMode; label: string }> = [
  { mode: 'simple', label: 'Entrada simple' },
  { mode: 'with_lot', label: 'Con lote' },
  { mode: 'with_po', label: 'Con orden de compra' },
];

export function EntryModeSelector() {
  const entryMode = useMovementsScreenStore((s) => s.entryMode);
  const setEntryMode = useMovementsScreenStore((s) => s.setEntryMode);

  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {MODES.map(({ mode, label }) => (
        <Button
          key={mode}
          type="button"
          variant={entryMode === mode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEntryMode(mode)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
