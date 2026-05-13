/**
 * app/(auth)/almacenes/page.tsx — thin orchestration shell for the
 * `/almacenes` LIST screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern) and `sdd/frontend-migration-almacenes/design` §2.1.
 *
 * State assignment:
 * - SERVER-OWNED (`/warehouses/with-stats`) → `useWarehousesWithStats` SWR
 *   wrapper with the basic-endpoint fallback baked into the fetcher (design
 *   §4.1 LOCKED).
 * - URL-SHAREABLE → NONE on this page; search + page are CLIENT-ONLY per
 *   ALM-LIST-INV-3.
 * - CROSS-COMPONENT screen state → `useAlmacenesScreenStore` (search query,
 *   pagination cursor, dialog flags, form draft, delete target).
 * - HYPER-LOCAL UI → small local `useState` for the error banner only.
 *
 * The LIST slice of `useAlmacenesScreenStore` is cleared on unmount via the
 * FS-2.2 cleanup effect.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { WarehouseCreateEditDialog } from '@/components/almacenes/warehouse-create-edit-dialog';
import { WarehouseDeleteConfirm } from '@/components/almacenes/warehouse-delete-confirm';
import { WarehouseGrid } from '@/components/almacenes/warehouse-grid';
import { WarehouseSearchBar } from '@/components/almacenes/warehouse-search-bar';
import { WarehouseSummaryStats } from '@/components/almacenes/warehouse-summary-stats';
import { PageTransition } from '@/components/shared/page-transition';
import { Button } from '@/components/ui/button';
import { useAlmacenesScreenStore } from '@/features/almacenes/store';
import { useWarehousesWithStats } from '@/lib/hooks/use-warehouses-with-stats';

const PER_PAGE = 20;

export default function AlmacenesPage() {
  const listSearch = useAlmacenesScreenStore((s) => s.listSearch);
  const setListSearch = useAlmacenesScreenStore((s) => s.setListSearch);
  const listPage = useAlmacenesScreenStore((s) => s.listPage);
  const setListPage = useAlmacenesScreenStore((s) => s.setListPage);
  const openCreateWarehouse = useAlmacenesScreenStore(
    (s) => s.openCreateWarehouse,
  );
  const openEditWarehouse = useAlmacenesScreenStore(
    (s) => s.openEditWarehouse,
  );
  const setDeleteTargetWarehouse = useAlmacenesScreenStore(
    (s) => s.setDeleteTargetWarehouse,
  );

  const { data: warehouses, total, isLoading, refresh } =
    useWarehousesWithStats(listPage, PER_PAGE);

  const [error, setError] = useState<string | null>(null);

  // FS-2.2 — reset the LIST slice when the page unmounts.
  useEffect(
    () => () => useAlmacenesScreenStore.getState().resetList(),
    [],
  );

  const filtered = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.address && w.address.toLowerCase().includes(q)),
    );
  }, [warehouses, listSearch]);

  const summaryStats = useMemo(() => {
    const totalProducts = warehouses.reduce((s, w) => s + w.products_count, 0);
    const totalCritical = warehouses.reduce((s, w) => s + w.critical_count, 0);
    const totalLow = warehouses.reduce((s, w) => s + w.low_stock_count, 0);
    const totalLocations = warehouses.reduce(
      (s, w) => s + w.locations_count,
      0,
    );
    return { totalProducts, totalCritical, totalLow, totalLocations };
  }, [warehouses]);

  const totalPages = Math.ceil(total / PER_PAGE);
  const hasData = !isLoading && warehouses.length > 0;

  return (
    <PageTransition>
      <div className="space-y-6" data-testid="almacenes-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Almacenes</h1>
            <p className="text-muted-foreground mt-1">
              Gestiona los almacenes de tu organizacion
            </p>
          </div>
          <Button
            onClick={openCreateWarehouse}
            data-testid="new-warehouse-btn"
          >
            Nuevo almacen
          </Button>
        </div>

        {error && (
          <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {hasData && (
          <WarehouseSummaryStats
            summaryStats={summaryStats}
            warehousesCount={warehouses.length}
          />
        )}

        {hasData && (
          <WarehouseSearchBar value={listSearch} onChange={setListSearch} />
        )}

        <WarehouseGrid
          items={filtered}
          isLoading={isLoading}
          originalCount={warehouses.length}
          searchQuery={listSearch}
          onEdit={openEditWarehouse}
          onDelete={setDeleteTargetWarehouse}
          onCreate={openCreateWarehouse}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="flex items-center justify-center gap-2"
            data-testid="pagination"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setListPage(Math.max(1, listPage - 1))}
              disabled={listPage <= 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {listPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setListPage(Math.min(totalPages, listPage + 1))}
              disabled={listPage >= totalPages}
            >
              Siguiente
            </Button>
          </div>
        )}

        <WarehouseCreateEditDialog
          onSaved={() => {
            void refresh();
          }}
          onCreated={() => {
            // Match legacy: after creating, jump back to page 1 so the new
            // warehouse is visible at the top of the list.
            setListPage(1);
          }}
          onError={setError}
        />

        <WarehouseDeleteConfirm
          onDeleted={() => {
            void refresh();
          }}
          onError={setError}
        />
      </div>
    </PageTransition>
  );
}
