/**
 * components/almacenes/map-tab.tsx — Mapa tab content for the
 * `/almacenes/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-8 + ALM-DETAIL-INV-9.
 *
 * Pure consumer boundary for the carved-out `components/warehouse/`
 * infrastructure (`MapCanvas`, `MapSummaryBar`, `ZoneDetail`). NEVER modify
 * those files — per design §5 LOCKED + ACCEPT-5 (carve-out preserved).
 *
 * Reads `selectedZone` from the DETAIL slice + dispatches `setSelectedZone`.
 * Receives `mapData` + `mapLoading` as props from the page shell (which
 * owns the SWR fetch via `useWarehouseMap`).
 *
 * Empty-state CTA: preserves the legacy `document.querySelector` testid
 * click EXACTLY per design §5.3 LOCKED — STRICT equivalence forbids
 * replacing it with a router/store action (the legacy code path goes
 * through the Tabs onValueChange handler, which is preserved).
 */
'use client';

import dynamic from 'next/dynamic';
import { HugeiconsIcon } from '@hugeicons/react';
import { MapsLocation01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { MapSummaryBar } from '@/components/warehouse/map-summary-bar';
import { ZoneDetail } from '@/components/warehouse/zone-detail';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { cn } from '@/lib/utils';
import type { WarehouseMapResponse } from '@/types';

const MapCanvas = dynamic(
  () => import('@/components/warehouse/map-canvas'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[600px] animate-pulse bg-muted rounded-xl" />
    ),
  },
);

interface MapTabProps {
  warehouseId: string;
  mapData: WarehouseMapResponse | undefined;
  mapLoading: boolean;
}

export function MapTab({ warehouseId, mapData, mapLoading }: MapTabProps) {
  const selectedZone = useAlmacenesScreenStore((s) => s.selectedZone);
  const setSelectedZone = useAlmacenesScreenStore(
    (s) => s.setSelectedZone,
  );

  if (mapLoading) {
    return (
      <div className="h-[600px] animate-pulse bg-muted rounded-xl" />
    );
  }

  if (mapData && mapData.zones.length > 0) {
    return (
      <div className="space-y-4">
        <MapSummaryBar summary={mapData.summary} />

        <div className="flex gap-4 relative">
          {/* Canvas — shrinks when zone is selected on desktop */}
          <div
            className={cn(
              'transition-all duration-300 ease-in-out min-w-0',
              selectedZone ? 'lg:w-[65%]' : 'w-full',
            )}
          >
            <MapCanvas
              zones={mapData.zones}
              canvasWidth={mapData.canvas_width ?? 1200}
              canvasHeight={mapData.canvas_height ?? 700}
              warehouseId={warehouseId}
              onZoneSelect={(zoneId) => {
                if (zoneId) {
                  const zone =
                    mapData.zones.find((z) => z.zone_id === zoneId) ?? null;
                  setSelectedZone(zone);
                } else {
                  setSelectedZone(null);
                }
              }}
            />
          </div>

          {/* Desktop side panel */}
          {selectedZone && (
            <div className="hidden lg:block w-[35%] min-w-[300px] max-h-[650px] overflow-y-auto animate-in slide-in-from-right-5 fade-in-0 duration-300">
              <ZoneDetail
                zone={selectedZone}
                warehouseId={warehouseId}
                onClose={() => setSelectedZone(null)}
              />
            </div>
          )}

          {/* Mobile bottom sheet overlay */}
          {selectedZone && (
            <div className="lg:hidden fixed inset-x-0 bottom-0 z-50 max-h-[50vh] overflow-y-auto border-t rounded-t-xl bg-card shadow-2xl animate-in slide-in-from-bottom-5 fade-in-0 duration-300">
              <ZoneDetail
                zone={selectedZone}
                warehouseId={warehouseId}
                onClose={() => setSelectedZone(null)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Empty state — preserve EXACT current UX per design §5.3 LOCKED.
  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 opacity-40 pointer-events-none select-none">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/30"
            />
          ))}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <HugeiconsIcon
            icon={MapsLocation01Icon}
            className="size-10 text-muted-foreground/50 mb-3"
          />
          <h3 className="text-base font-medium mb-1">
            Crea zonas en tu almacen para visualizar el mapa de stock
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            Las zonas agrupan tus ubicaciones y muestran el estado del
            inventario de forma visual.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              // Preserve EXACT legacy UX per design §5.3 LOCKED.
              const tab = document.querySelector<HTMLButtonElement>(
                '[data-testid="tab-ubicaciones"]',
              );
              tab?.click();
            }}
          >
            Crear zona
          </Button>
        </div>
      </div>
    </div>
  );
}
