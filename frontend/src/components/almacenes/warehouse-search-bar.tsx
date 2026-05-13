/**
 * components/almacenes/warehouse-search-bar.tsx — controlled search input
 * for the `/almacenes` list page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-3 (client-side
 * filter, NOT URL-bound).
 *
 * Presentational. The consumer wires `value` + `onChange` to the store
 * (`listSearch` + `setListSearch`). Preserves the `warehouse-search`
 * testid and the Spanish placeholder verbatim.
 */
'use client';

import { Input } from '@/components/ui/input';

interface WarehouseSearchBarProps {
  value: string;
  onChange: (next: string) => void;
}

export function WarehouseSearchBar({
  value,
  onChange,
}: WarehouseSearchBarProps) {
  return (
    <div className="max-w-sm">
      <Input
        placeholder="Buscar almacen por nombre o direccion..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="warehouse-search"
      />
    </div>
  );
}
