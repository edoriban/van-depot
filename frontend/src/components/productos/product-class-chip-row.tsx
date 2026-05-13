/**
 * components/productos/product-class-chip-row.tsx — URL-bound class chip
 * row + manufacturables toggle chip for the productos LIST page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-3 (URL
 * roundtrip). Per STRUCT-7 the component is PURELY presentational —
 * URL reads + writes live on the page shell; this component receives
 * the current values + callbacks as props.
 *
 * Preserves the `class-chip-row` container testid plus
 * `class-chip-all|raw-material|consumable|tool-spare|manufactured`
 * button testids verbatim per spec PROD-LIST-INV-1.
 */
'use client';

import { cn } from '@/lib/utils';
import type { ProductClass } from '@/types';

// Chip row filter. Value `null` means "Todos" (no filter). URL-bound via
// `?class=`; invalid or missing values behave as "Todos".
const CLASS_CHIPS: ReadonlyArray<{
  value: ProductClass | null;
  label: string;
  testId: string;
}> = [
  { value: null, label: 'Todos', testId: 'class-chip-all' },
  { value: 'raw_material', label: 'Materia prima', testId: 'class-chip-raw-material' },
  { value: 'consumable', label: 'Consumibles', testId: 'class-chip-consumable' },
  { value: 'tool_spare', label: 'Herramientas', testId: 'class-chip-tool-spare' },
] as const;

interface ProductClassChipRowProps {
  filterClass: ProductClass | null;
  filterManufactured: boolean;
  onClassChange: (next: ProductClass | null) => void;
  onManufacturedToggle: () => void;
}

export function ProductClassChipRow({
  filterClass,
  filterManufactured,
  onClassChange,
  onManufacturedToggle,
}: ProductClassChipRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      aria-label="Filtrar por clase de producto"
      data-testid="class-chip-row"
    >
      {CLASS_CHIPS.map((chip) => {
        const isActive = filterClass === chip.value;
        return (
          <button
            key={chip.testId}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onClassChange(chip.value)}
            data-testid={chip.testId}
            data-active={isActive ? 'true' : 'false'}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {chip.label}
          </button>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected={filterManufactured}
        onClick={onManufacturedToggle}
        data-testid="class-chip-manufactured"
        data-active={filterManufactured ? 'true' : 'false'}
        className={cn(
          'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors',
          filterManufactured
            ? 'border-orange-500 bg-orange-500 text-white'
            : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        Manufacturables
      </button>
    </div>
  );
}
