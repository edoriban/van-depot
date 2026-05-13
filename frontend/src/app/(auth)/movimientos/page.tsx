/**
 * app/(auth)/movimientos/page.tsx — thin orchestration shell for the
 * Movimientos screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern).
 *
 * Owns URL state (tab + work_order_id + page + movement_type filter) via
 * `useSearchParams`. Form state lives in `useMovementsScreenStore` and is
 * cleared on unmount via the FS-2.2 cleanup effect. Subcomponents under
 * `components/movements/` render every visual element.
 */
'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdjustmentForm } from '@/components/movements/adjustment-form';
import { EntryTabContent } from '@/components/movements/entry-tab-content';
import { ExitForm } from '@/components/movements/exit-form';
import {
  MovementsHistoryTable,
  PER_PAGE,
  type MovementWithDetails,
} from '@/components/movements/movements-history-table';
import { TransferForm } from '@/components/movements/transfer-form';
import { useMovementsScreenStore } from '@/features/movements/store';
import { api, getWorkOrder } from '@/lib/api-mutations';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import type {
  PaginatedResponse,
  Product,
  Supplier,
  Warehouse,
} from '@/types';

function MovementsPageInner() {
  const searchParams = useSearchParams();
  const { replace } = useRouter();
  const activeTab = searchParams.get('tab') || 'entry';
  const workOrderIdParam = searchParams.get('work_order_id') ?? '';

  const filterWorkOrder = useMovementsScreenStore((s) => s.filterWorkOrder);
  const setFilterWorkOrder = useMovementsScreenStore((s) => s.setFilterWorkOrder);
  const highlightNew = useMovementsScreenStore((s) => s.highlightNew);
  const setHighlightNew = useMovementsScreenStore((s) => s.setHighlightNew);

  // FS-2.2 — reset the screen store when the page unmounts.
  useEffect(() => () => useMovementsScreenStore.getState().reset(), []);

  const handleTabChange = (value: string) => {
    // Read the current pathname inside the handler so the component does NOT
    // re-render on every navigation event (rerender-defer-reads-hook).
    const currentPath = window.location.pathname;
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', value);
    replace(`${currentPath}?${sp.toString()}`, { scroll: false });
  };

  const clearWorkOrderFilter = () => {
    const currentPath = window.location.pathname;
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('work_order_id');
    const qs = sp.toString();
    replace(qs ? `${currentPath}?${qs}` : currentPath, { scroll: false });
  };

  // Lookups for the form subcomponents that receive them as props.
  const { data: products } = useResourceList<Product>('/products');
  const { data: warehouses } = useResourceList<Warehouse>('/warehouses');
  const { data: suppliers } = useResourceList<Supplier>('/suppliers');

  // Resolve the WO chip for the breadcrumb. Runs only when the URL carries a
  // work_order_id.
  useEffect(() => {
    let cancelled = false;
    if (!workOrderIdParam) {
      setFilterWorkOrder(null);
      return;
    }
    getWorkOrder(workOrderIdParam)
      .then((wo) => {
        if (!cancelled) setFilterWorkOrder(wo);
      })
      .catch(() => {
        if (!cancelled) setFilterWorkOrder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderIdParam, setFilterWorkOrder]);

  // History fetch.
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');

  const fetchMovements = useCallback(
    async (p: number, typeFilter: string, workOrderId: string) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) });
        if (typeFilter) params.set('movement_type', typeFilter);
        if (workOrderId) params.set('work_order_id', workOrderId);
        const res = await api.get<PaginatedResponse<MovementWithDetails>>(
          `/movements?${params}`,
        );
        setMovements(res.data);
        setTotal(res.total);
      } catch {
        toast.error('Error al cargar historial de movimientos');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchMovements(page, filterType, workOrderIdParam);
  }, [page, filterType, workOrderIdParam, fetchMovements]);

  const handleSuccess = () => {
    setPage(1);
    setHighlightNew(true);
    fetchMovements(1, filterType, workOrderIdParam);
    setTimeout(() => setHighlightNew(false), 2000);
  };

  return (
    <div className="space-y-8" data-testid="movements-page">
      <div>
        <h1 className="text-2xl font-semibold">Movimientos</h1>
        <p className="text-muted-foreground mt-1">
          Registra entradas, salidas, transferencias y ajustes de inventario
        </p>
      </div>

      <Card className="p-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} data-testid="movement-tabs">
          <TabsList data-testid="movement-tabs-list">
            <TabsTrigger value="entry" data-testid="tab-entry">
              Entrada
            </TabsTrigger>
            <TabsTrigger value="exit" data-testid="tab-exit">
              Salida
            </TabsTrigger>
            <TabsTrigger value="transfer" data-testid="tab-transfer">
              Transferencia
            </TabsTrigger>
            <TabsTrigger value="adjustment" data-testid="tab-adjustment">
              Ajuste
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entry" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">
              Registra material que llega al almacen
            </p>
            <EntryTabContent
              products={products}
              warehouses={warehouses}
              suppliers={suppliers}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="exit" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">
              Registra material que sale del almacen
            </p>
            <ExitForm products={products} warehouses={warehouses} onSuccess={handleSuccess} />
          </TabsContent>

          <TabsContent value="transfer" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">
              Mueve material entre ubicaciones
            </p>
            <TransferForm
              products={products}
              warehouses={warehouses}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="adjustment" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">
              Corrige cantidades despues de un conteo fisico
            </p>
            <AdjustmentForm
              products={products}
              warehouses={warehouses}
              onSuccess={handleSuccess}
            />
          </TabsContent>
        </Tabs>
      </Card>

      <MovementsHistoryTable
        movements={movements}
        total={total}
        page={page}
        isLoading={isLoading}
        filterType={filterType}
        onFilterTypeChange={(next) => {
          setFilterType(next);
          setPage(1);
        }}
        onPageChange={setPage}
        highlightNew={highlightNew}
        products={products}
        workOrderIdParam={workOrderIdParam}
        filterWorkOrder={filterWorkOrder}
        onClearWorkOrderFilter={clearWorkOrderFilter}
      />
    </div>
  );
}

export default function MovementsPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <MovementsPageInner />
    </Suspense>
  );
}
