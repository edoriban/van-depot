/**
 * components/almacenes/locations-tab.tsx — Ubicaciones tab content for the
 * `/almacenes/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-3..5.
 *
 * Consumes `useWarehouseLocations(warehouseId)` for the tree data + the
 * Zustand DETAIL slice for expand-state, the dialog, and the delete
 * target. Renders:
 *   - Top bar (count + `Nueva zona` button)
 *   - EmptyState branch (when total === 0)
 *   - Expand-all / Collapse-all controls
 *   - Recursive tree of `<LocationTreeNode />` for root zones
 *   - Orphan section for non-zone locations without a parent
 *   - `<LocationCreateEditDialog />` + `<LocationDeleteConfirm />`
 *
 * Preserves: `new-location-btn` testid + the count copy verbatim.
 */
'use client';

import { type ReactNode, useMemo } from 'react';
import { Location01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouseLocations } from '@/lib/hooks/use-warehouse-locations';
import type { Location, LocationType } from '@/types';
import {
  CHILD_TYPES,
  LOCATION_TYPES_DEFAULT,
  LocationTreeNode,
} from './location-tree-node';
import { LocationCreateEditDialog } from './location-create-edit-dialog';
import { LocationDeleteConfirm } from './location-delete-confirm';

interface LocationsTabProps {
  warehouseId: string;
  onError?: (message: string) => void;
}

function computeAllowedTypes(
  parentType: LocationType | null,
): LocationType[] {
  if (!parentType) return LOCATION_TYPES_DEFAULT;
  const allowed = CHILD_TYPES[parentType] ?? [];
  return allowed.length > 0 ? allowed : LOCATION_TYPES_DEFAULT;
}

function computeAllowedTypesForEdit(
  location: Location,
  allLocations: Location[],
): LocationType[] {
  if (location.parent_id) {
    const parent = allLocations.find((l) => l.id === location.parent_id);
    if (parent) return computeAllowedTypes(parent.location_type);
  }
  return LOCATION_TYPES_DEFAULT;
}

export function LocationsTab({
  warehouseId,
  onError,
}: LocationsTabProps) {
  const { data: allLocations, total, isLoading, error } =
    useWarehouseLocations(warehouseId);

  const expandedIds = useAlmacenesScreenStore((s) => s.expandedLocationIds);
  const toggleExpand = useAlmacenesScreenStore(
    (s) => s.toggleExpandedLocation,
  );
  const expandAll = useAlmacenesScreenStore((s) => s.expandAllLocations);
  const collapseAll = useAlmacenesScreenStore(
    (s) => s.collapseAllLocations,
  );
  const openCreateLocation = useAlmacenesScreenStore(
    (s) => s.openCreateLocation,
  );
  const openEditLocation = useAlmacenesScreenStore(
    (s) => s.openEditLocation,
  );
  const setDeleteTargetLocation = useAlmacenesScreenStore(
    (s) => s.setDeleteTargetLocation,
  );

  const rootLocations = useMemo(
    () => allLocations.filter((l) => !l.parent_id),
    [allLocations],
  );
  const orphanLocations = useMemo(
    () =>
      allLocations.filter(
        (l) => !l.parent_id && l.location_type !== 'zone',
      ),
    [allLocations],
  );

  const handleAddChild = (parentId: string, parentType: LocationType) => {
    openCreateLocation(
      parentId,
      parentType,
      computeAllowedTypes(parentType),
    );
  };

  const handleEdit = (location: Location) => {
    openEditLocation(
      location,
      computeAllowedTypesForEdit(location, allLocations),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} ubicacion{total !== 1 ? 'es' : ''} en este almacen
        </p>
        <Button
          onClick={() => openCreateLocation(null, null, LOCATION_TYPES_DEFAULT)}
          data-testid="new-location-btn"
        >
          Nueva zona
        </Button>
      </div>

      {error !== undefined && error !== null && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Error al cargar ubicaciones'}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded skeleton-shimmer" />
          ))}
        </div>
      ) : allLocations.length === 0 ? (
        <EmptyState
          icon={Location01Icon}
          title="Aun no tienes ubicaciones"
          description="Crea zonas y estantes para saber donde esta cada cosa."
          actionLabel="Nueva zona"
          onAction={() =>
            openCreateLocation(null, null, LOCATION_TYPES_DEFAULT)
          }
        />
      ) : (
        <>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => expandAll(allLocations.map((l) => l.id))}
            >
              Expandir todo
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              Colapsar todo
            </Button>
          </div>

          <div className="border rounded-lg divide-y">
            {rootLocations.map((location) => (
              <LocationTreeNode
                key={location.id}
                location={location}
                allLocations={allLocations}
                depth={0}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                onAddChild={handleAddChild}
                onEdit={handleEdit}
                onDelete={setDeleteTargetLocation}
              />
            ))}
          </div>

          {orphanLocations.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">
                Ubicaciones sin zona asignada:
              </p>
              <div className="border rounded-lg divide-y">
                {allLocations.reduce<ReactNode[]>((acc, location) => {
                  if (location.parent_id || location.location_type === 'zone')
                    return acc;
                  acc.push(
                    <LocationTreeNode
                      key={location.id}
                      location={location}
                      allLocations={allLocations}
                      depth={0}
                      expandedIds={expandedIds}
                      onToggleExpand={toggleExpand}
                      onAddChild={handleAddChild}
                      onEdit={handleEdit}
                      onDelete={setDeleteTargetLocation}
                    />,
                  );
                  return acc;
                }, [])}
              </div>
            </div>
          )}
        </>
      )}

      <LocationCreateEditDialog
        warehouseId={warehouseId}
        allLocations={allLocations}
        onError={onError}
      />
      <LocationDeleteConfirm onError={onError} />
    </div>
  );
}
