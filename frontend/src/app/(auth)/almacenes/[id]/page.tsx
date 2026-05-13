/**
 * app/(auth)/almacenes/[id]/page.tsx — thin orchestration shell for the
 * `/almacenes/[id]` warehouse DETAIL screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern) and `sdd/frontend-migration-almacenes/design` §2.2 + §4.
 *
 * Owns:
 *   - `id` route param resolution via `useParams`.
 *   - The `?tab=` querystring read via `useSearchParams` (STRUCT-7 —
 *     useSearchParams reads are PAGE-SHELL-ONLY; subcomponents take props).
 *   - The detail-warehouse SWR fetch (`useWarehouse`) + map fetch
 *     (`useWarehouseMap`).
 *   - Composition of the 4 tab subcomponents under `components/almacenes/`.
 *   - The `setDetailWarehouseId(warehouseId)` effect that resets the DETAIL
 *     slice's tree-expand/select/pagination state on cross-warehouse
 *     navigation (design R2 mitigation).
 *
 * Detail-slice cleanup mounted via FS-2.2 so the LIST slice survives the
 * back navigation and preserves the list page's URL filters.
 */
'use client';

import { Suspense, useEffect } from 'react';
import {
  useParams,
  useSearchParams,
  useRouter,
  usePathname,
} from 'next/navigation';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { InventoryTab } from '@/components/almacenes/inventory-tab';
import { LocationsTab } from '@/components/almacenes/locations-tab';
import { MapTab } from '@/components/almacenes/map-tab';
import { MovementsTab } from '@/components/almacenes/movements-tab';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehouse } from '@/lib/hooks/use-warehouse';
import { useWarehouseMap } from '@/lib/hooks/use-warehouse-map';

function WarehouseDetailPageInner() {
  const params = useParams<{ id: string }>();
  const warehouseId = params.id;
  const searchParams = useSearchParams();
  const { replace } = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') || 'ubicaciones';

  const setDetailWarehouseId = useAlmacenesScreenStore(
    (s) => s.setDetailWarehouseId,
  );

  // FS-2.2 — reset the DETAIL slice when the page unmounts. The LIST slice
  // is preserved so back navigation restores the list's search + page.
  useEffect(
    () => () => useAlmacenesScreenStore.getState().resetDetail(),
    [],
  );

  // Track the active warehouse id in the store so cross-warehouse
  // navigation (A → B) clears expand/select/pagination state for the new
  // warehouse (design R2 mitigation).
  useEffect(() => {
    setDetailWarehouseId(warehouseId);
  }, [warehouseId, setDetailWarehouseId]);

  const { warehouse, isLoading, error } = useWarehouse(warehouseId);
  const { data: mapData, isLoading: mapLoading } =
    useWarehouseMap(warehouseId);

  const handleTabChange = (value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', value);
    replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="warehouse-detail-loading">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded skeleton-shimmer" />
          <div className="space-y-2">
            <div className="h-6 w-48 rounded skeleton-shimmer" />
            <div className="h-4 w-32 rounded skeleton-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !warehouse) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo cargar el almacen solicitado.';
    return (
      <div className="space-y-6" data-testid="warehouse-detail-error">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/almacenes">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Almacen no encontrado</h1>
        </div>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="warehouse-detail-page">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/almacenes" data-testid="back-to-warehouses">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{warehouse.name}</h1>
          <p className="text-muted-foreground">
            {warehouse.address || 'Sin direccion'}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="ubicaciones" data-testid="tab-ubicaciones">
            Ubicaciones
          </TabsTrigger>
          <TabsTrigger value="inventario" data-testid="tab-inventario">
            Inventario
          </TabsTrigger>
          <TabsTrigger value="movimientos" data-testid="tab-movimientos">
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="mapa" data-testid="tab-mapa">
            Mapa
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="ubicaciones"
          className="animate-in fade-in-0 duration-200"
        >
          <LocationsTab warehouseId={warehouseId} />
        </TabsContent>

        <TabsContent
          value="inventario"
          className="animate-in fade-in-0 duration-200"
        >
          <InventoryTab warehouseId={warehouseId} />
        </TabsContent>

        <TabsContent
          value="movimientos"
          className="animate-in fade-in-0 duration-200"
        >
          <MovementsTab warehouseId={warehouseId} />
        </TabsContent>

        <TabsContent
          value="mapa"
          className="animate-in fade-in-0 duration-200 space-y-4"
        >
          <MapTab
            warehouseId={warehouseId}
            mapData={mapData}
            mapLoading={mapLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function WarehouseDetailPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <WarehouseDetailPageInner />
    </Suspense>
  );
}
