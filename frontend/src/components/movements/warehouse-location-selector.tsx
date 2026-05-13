/**
 * components/movements/warehouse-location-selector.tsx — shared warehouse +
 * location combobox pair used by every movimiento form variant.
 *
 * See `frontend/src/CONVENTIONS.md` §2.1 (the 8+ props "smell" that
 * motivated this extraction) and §7.1 (Migration pattern).
 *
 * The `excludeLocationId` and `excludeReception` filters are applied at the
 * presentational layer so the parent owns no filtering logic. Placeholders
 * ("Buscar almacen...", "Buscar ubicacion...") are load-bearing for the
 * existing Playwright specs and MUST stay verbatim.
 */
'use client';

import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { Location, Warehouse } from '@/types';

export interface WarehouseLocationSelectorProps {
  warehouses: Warehouse[];
  warehouseId: string;
  onWarehouseChange: (id: string) => void;
  locationId: string;
  onLocationChange: (id: string) => void;
  locations: Location[];
  excludeLocationId?: string;
  excludeReception?: boolean;
  label: string;
  locationHelpText?: string;
  locationTestId: string;
  warehouseTestId: string;
}

export function WarehouseLocationSelector({
  warehouses,
  warehouseId,
  onWarehouseChange,
  locationId,
  onLocationChange,
  locations,
  excludeLocationId,
  excludeReception,
  label,
  locationHelpText,
  locationTestId,
  warehouseTestId,
}: WarehouseLocationSelectorProps) {
  let filteredLocations = locations;
  if (excludeLocationId) {
    filteredLocations = filteredLocations.filter((l) => l.id !== excludeLocationId);
  }
  if (excludeReception) {
    filteredLocations = filteredLocations.filter((l) => l.location_type !== 'reception');
  }
  return (
    <>
      <div className="space-y-2" data-testid={warehouseTestId}>
        <Label>Almacen</Label>
        <SearchableSelect
          value={warehouseId || undefined}
          onValueChange={(val) => {
            onWarehouseChange(val);
            onLocationChange('');
          }}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          placeholder="Seleccionar almacen"
          searchPlaceholder="Buscar almacen..."
        />
      </div>
      <div className="space-y-2" data-testid={locationTestId}>
        <Label>{label}</Label>
        <SearchableSelect
          value={locationId || undefined}
          onValueChange={onLocationChange}
          disabled={!warehouseId}
          options={filteredLocations.map((l) => ({
            value: l.id,
            label: `${l.name}${l.label ? ` (${l.label})` : ''}`,
          }))}
          placeholder={warehouseId ? 'Seleccionar ubicacion' : 'Selecciona un almacen primero'}
          searchPlaceholder="Buscar ubicacion..."
        />
        {locationHelpText && (
          <p className="text-xs text-muted-foreground">{locationHelpText}</p>
        )}
      </div>
    </>
  );
}
