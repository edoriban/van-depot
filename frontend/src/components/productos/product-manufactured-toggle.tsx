/**
 * components/productos/product-manufactured-toggle.tsx — the class-gated
 * "Manufacturable" checkbox + reset-warning banner inside the product
 * create/edit dialog.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-5.
 *
 * - When productClass === 'raw_material' the toggle is enabled.
 * - When productClass !== 'raw_material' a disabled placeholder explains
 *   the class-gate.
 * - When manufacturedResetWarning is true (one-shot, set by the store on
 *   class change FROM raw_material with isManufactured was true) the
 *   warning banner renders.
 *
 * Testids: `product-is-manufactured-toggle`,
 * `product-is-manufactured-disabled`, `product-manufactured-reset-warning`.
 */
'use client';

import { Label } from '@/components/ui/label';
import type { ProductClass } from '@/types';

interface ProductManufacturedToggleProps {
  productClass: ProductClass;
  isManufactured: boolean;
  manufacturedResetWarning: boolean;
  onChange: (next: boolean) => void;
}

export function ProductManufacturedToggle({
  productClass,
  isManufactured,
  manufacturedResetWarning,
  onChange,
}: ProductManufacturedToggleProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="product-is-manufactured">Manufacturable</Label>
      {productClass === 'raw_material' ? (
        <div className="flex flex-col gap-1">
          <div className="flex h-9 items-center gap-2">
            <input
              id="product-is-manufactured"
              type="checkbox"
              checked={isManufactured}
              onChange={(e) => onChange(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
              data-testid="product-is-manufactured-toggle"
            />
            <label
              htmlFor="product-is-manufactured"
              className="text-sm text-muted-foreground"
            >
              Marcar si este producto se fabrica internamente (puede ser el
              objetivo de una orden de trabajo).
            </label>
          </div>
        </div>
      ) : (
        <div
          className="flex h-9 items-center text-sm text-muted-foreground"
          data-testid="product-is-manufactured-disabled"
        >
          Solo los productos de clase &ldquo;Materia prima&rdquo; pueden
          marcarse como manufacturables.
        </div>
      )}
      {manufacturedResetWarning && (
        <p
          className="text-xs text-amber-600 dark:text-amber-400"
          data-testid="product-manufactured-reset-warning"
        >
          El indicador &ldquo;Manufacturable&rdquo; se desactiva al cambiar
          la clase.
        </p>
      )}
    </div>
  );
}
