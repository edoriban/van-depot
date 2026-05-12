'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  api,
  createWorkOrder,
  isApiError,
  listWorkOrders,
} from '@/lib/api-mutations';
import type {
  Location,
  PaginatedResponse,
  Product,
  Recipe,
  RecipeDetail,
  Warehouse,
  WorkOrder,
  WorkOrderStatus,
} from '@/types';
import {
  WORK_ORDER_STATUS_BADGE_CLASSES,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VALUES,
} from '@/types';
import { cn } from '@/lib/utils';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FactoryIcon } from '@hugeicons/core-free-icons';

const PER_PAGE = 20;

// All four statuses + "Todos" sentinel. URL-bound via `?status=`; invalid or
// missing values behave as "Todos".
const STATUS_CHIPS: ReadonlyArray<{
  value: WorkOrderStatus | null;
  label: string;
  testId: string;
}> = [
  { value: null, label: 'Todos', testId: 'status-chip-all' },
  ...WORK_ORDER_STATUS_VALUES.map((v) => ({
    value: v,
    label: WORK_ORDER_STATUS_LABELS[v],
    testId: `status-chip-${v}`,
  })),
] as const;

function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return (
    value === 'draft' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'cancelled'
  );
}

// Spanish error copy keyed by the backend `code` discriminator. 422s are
// validation-shape errors (catchable before save once we know the data), 409s
// are genuine conflicts at save time — but here only 422s are reachable on
// create. The generic fallback keeps the UI from swallowing anything.
const CREATE_ERROR_LABELS: Record<string, string> = {
  WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED:
    'El producto terminado seleccionado no esta marcado como manufacturable.',
  WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER:
    'El almacen seleccionado no tiene ningun centro de trabajo configurado.',
  WORK_ORDER_BOM_INCLUDES_TOOL_SPARE:
    'La receta contiene herramientas o refacciones — elimina esos items antes de crear la orden.',
  RECIPE_ITEM_REJECTS_TOOL_SPARE:
    'La receta contiene un producto herramienta/refaccion que no se puede consumir.',
  PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL:
    'El producto debe ser de clase Materia prima para ser manufacturable.',
};

function OrdenesDeTrabajoPageInner() {
  const { replace } = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawStatus = searchParams.get('status');
  const filterStatus: WorkOrderStatus | null = isWorkOrderStatus(rawStatus)
    ? rawStatus
    : null;
  const filterWarehouseId = searchParams.get('warehouse_id') ?? '';
  const filterWorkCenterId =
    searchParams.get('work_center_location_id') ?? '';
  const filterSearch = searchParams.get('search') ?? '';

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Reference data — loaded once.
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [allLocations, setAllLocations] = useState<Location[]>([]);

  // Creation dialog state — all controlled, consistent with the existing
  // productos / recetas forms (no react-hook-form in the project).
  const [formOpen, setFormOpen] = useState(false);
  const [formRecipeId, setFormRecipeId] = useState('');
  const [formFgProductId, setFormFgProductId] = useState('');
  const [formFgQuantity, setFormFgQuantity] = useState('1');
  const [formWarehouseId, setFormWarehouseId] = useState('');
  const [formWorkCenterId, setFormWorkCenterId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);

  const fetchWorkOrders = useCallback(
    async (
      p: number,
      status: WorkOrderStatus | null,
      warehouseId: string,
      workCenterId: string,
      search: string,
    ) => {
      setIsLoading(true);
      try {
        const res = await listWorkOrders({
          page: p,
          per_page: PER_PAGE,
          status: status ?? undefined,
          warehouse_id: warehouseId || undefined,
          work_center_location_id: workCenterId || undefined,
          search: search || undefined,
        });
        setWorkOrders(res.data);
        setTotal(res.total);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al cargar ordenes',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchWorkOrders(
      page,
      filterStatus,
      filterWarehouseId,
      filterWorkCenterId,
      filterSearch,
    );
  }, [
    page,
    filterStatus,
    filterWarehouseId,
    filterWorkCenterId,
    filterSearch,
    fetchWorkOrders,
  ]);

  // Load reference data once on mount for selectors + display.
  useEffect(() => {
    void api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => {
        setWarehouses(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {});
    void api
      .get<Product[] | PaginatedResponse<Product>>(
        '/products?is_manufactured=true&per_page=200',
      )
      .then((res) => {
        setProducts(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {});
    void api
      .get<PaginatedResponse<Recipe>>('/recipes?page=1&per_page=200')
      .then((res) => {
        setRecipes(res.data);
      })
      .catch(() => {});
    // Fetch all locations once — we filter client-side by warehouse + type
    // for the work-center selector. The backend exposes per-warehouse
    // locations via `/warehouses/{id}/locations` which is what we'll use.
    setAllLocations([]);
  }, []);

  // When the user selects a warehouse in the filter or in the form, fetch
  // that warehouse's locations to populate the work-center dropdowns.
  const [warehouseLocations, setWarehouseLocations] = useState<
    Record<string, Location[]>
  >({});
  const loadLocationsForWarehouse = useCallback(
    async (warehouseId: string) => {
      if (!warehouseId || warehouseLocations[warehouseId]) return;
      try {
        const res = await api.get<Location[] | PaginatedResponse<Location>>(
          `/warehouses/${warehouseId}/locations`,
        );
        const items = Array.isArray(res) ? res : res.data;
        setWarehouseLocations((prev) => ({ ...prev, [warehouseId]: items }));
      } catch {
        // silent — the dropdown will just show empty
      }
    },
    [warehouseLocations],
  );

  useEffect(() => {
    void loadLocationsForWarehouse(filterWarehouseId);
  }, [filterWarehouseId, loadLocationsForWarehouse]);

  useEffect(() => {
    void loadLocationsForWarehouse(formWarehouseId);
  }, [formWarehouseId, loadLocationsForWarehouse]);

  const updateQueryParam = (name: string, value: string | null) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (value === null || value === '') {
      sp.delete(name);
    } else {
      sp.set(name, value);
    }
    const qs = sp.toString();
    replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleStatusChipClick = (next: WorkOrderStatus | null) => {
    updateQueryParam('status', next);
    setPage(1);
  };

  const handleWarehouseFilterChange = (id: string) => {
    updateQueryParam('warehouse_id', id || null);
    // Dropping the warehouse drops the work-center too (they're nested).
    updateQueryParam('work_center_location_id', null);
    setPage(1);
  };

  const handleWorkCenterFilterChange = (id: string) => {
    updateQueryParam('work_center_location_id', id || null);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    updateQueryParam('search', value || null);
    setPage(1);
  };

  // Load the selected recipe's items whenever formRecipeId changes so the
  // preview block can show the ingredient list. Recipes are relatively
  // small (≤20 items typical) so no pagination concerns.
  useEffect(() => {
    let cancelled = false;
    if (!formRecipeId) {
      setSelectedRecipe(null);
      return;
    }
    void api
      .get<RecipeDetail>(`/recipes/${formRecipeId}`)
      .then((detail) => {
        if (!cancelled) setSelectedRecipe(detail);
      })
      .catch(() => {
        if (!cancelled) setSelectedRecipe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [formRecipeId]);

  const openCreateDialog = () => {
    setFormRecipeId('');
    setFormFgProductId('');
    setFormFgQuantity('1');
    setFormWarehouseId('');
    setFormWorkCenterId('');
    setFormNotes('');
    setSelectedRecipe(null);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const created = await createWorkOrder({
        recipe_id: formRecipeId,
        fg_product_id: formFgProductId,
        fg_quantity: Number(formFgQuantity),
        warehouse_id: formWarehouseId,
        work_center_location_id: formWorkCenterId,
        notes: formNotes || undefined,
      });
      setFormOpen(false);
      toast.success(`Orden ${created.code} creada`);
      fetchWorkOrders(
        1,
        filterStatus,
        filterWarehouseId,
        filterWorkCenterId,
        filterSearch,
      );
      setPage(1);
    } catch (err) {
      if (isApiError(err) && err.code && CREATE_ERROR_LABELS[err.code]) {
        toast.error(CREATE_ERROR_LABELS[err.code]);
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Error al crear orden',
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Lookup helpers for the table — avoids refetching the world per render.
  const warehouseMap = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w])),
    [warehouses],
  );
  const locationMap = useMemo(() => {
    const m = new Map<string, Location>();
    for (const list of Object.values(warehouseLocations)) {
      for (const l of list) m.set(l.id, l);
    }
    for (const l of allLocations) m.set(l.id, l);
    return m;
  }, [warehouseLocations, allLocations]);
  // Products lookup for FG display — backed by the `is_manufactured=true`
  // page-1 fetch, sufficient while the MFG catalog is small.
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const workCenterLocations = useMemo(() => {
    if (!filterWarehouseId) return [] as Location[];
    return (warehouseLocations[filterWarehouseId] ?? []).filter(
      (l) => l.location_type === 'work_center',
    );
  }, [warehouseLocations, filterWarehouseId]);

  const formWorkCenterLocations = useMemo(() => {
    if (!formWarehouseId) return [] as Location[];
    return (warehouseLocations[formWarehouseId] ?? []).filter(
      (l) => l.location_type === 'work_center',
    );
  }, [warehouseLocations, formWarehouseId]);

  const columns: ColumnDef<WorkOrder>[] = [
    {
      key: 'code',
      header: 'Codigo',
      render: (w) => (
        <Link
          href={`/ordenes-de-trabajo/${w.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
          data-testid="work-order-detail-link"
        >
          {w.code}
        </Link>
      ),
    },
    {
      key: 'fg',
      header: 'Producto terminado',
      render: (w) => {
        const p = productMap.get(w.fg_product_id);
        return p ? (
          <span>
            <span className="font-medium">{p.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {p.sku}
            </span>
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {w.fg_product_id.slice(0, 8)}…
          </span>
        );
      },
    },
    {
      key: 'fg_quantity',
      header: 'Cantidad',
      render: (w) => w.fg_quantity,
    },
    {
      key: 'warehouse',
      header: 'Almacen',
      render: (w) =>
        warehouseMap.get(w.warehouse_id)?.name ?? (
          <span className="font-mono text-xs text-muted-foreground">
            {w.warehouse_id.slice(0, 8)}…
          </span>
        ),
    },
    {
      key: 'work_center',
      header: 'Centro',
      render: (w) =>
        locationMap.get(w.work_center_location_id)?.name ?? (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (w) => (
        <Badge
          variant="outline"
          className={cn(
            'border-0',
            WORK_ORDER_STATUS_BADGE_CLASSES[w.status],
          )}
          data-testid="work-order-status-badge"
          data-status={w.status}
        >
          {WORK_ORDER_STATUS_LABELS[w.status]}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Creada',
      render: (w) =>
        new Date(w.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (w) => (
        <Link
          href={`/ordenes-de-trabajo/${w.id}`}
          className="text-sm text-primary hover:underline"
        >
          Ver detalle
        </Link>
      ),
    },
  ];

  const canSubmit =
    !!formRecipeId &&
    !!formFgProductId &&
    Number(formFgQuantity) > 0 &&
    !!formWarehouseId &&
    !!formWorkCenterId;

  return (
    <div className="space-y-6" data-testid="ordenes-de-trabajo-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ordenes de trabajo</h1>
          <p className="text-muted-foreground mt-1">
            Planifica, entrega y completa ordenes para fabricar producto
            terminado desde tus recetas.
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-work-order-btn">
          Nueva orden
        </Button>
      </div>

      {/* Status chip-row (URL-bound via ?status=). */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Filtrar por estado de orden"
        data-testid="status-chip-row"
      >
        {STATUS_CHIPS.map((chip) => {
          const isActive = filterStatus === chip.value;
          return (
            <button
              key={chip.testId}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleStatusChipClick(chip.value)}
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
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Buscar codigo, FG o SKU..."
          value={filterSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-sm"
          data-testid="search-input"
        />
        <SearchableSelect
          value={filterWarehouseId || 'all'}
          onValueChange={(val) =>
            handleWarehouseFilterChange(val === 'all' ? '' : val)
          }
          options={[
            { value: 'all', label: 'Todos los almacenes' },
            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
          ]}
          placeholder="Todos los almacenes"
          searchPlaceholder="Buscar almacen..."
          className="max-w-xs"
        />
        <SearchableSelect
          value={filterWorkCenterId || 'all'}
          onValueChange={(val) =>
            handleWorkCenterFilterChange(val === 'all' ? '' : val)
          }
          options={[
            { value: 'all', label: 'Todos los centros' },
            ...workCenterLocations.map((l) => ({
              value: l.id,
              label: l.name,
            })),
          ]}
          placeholder={
            filterWarehouseId
              ? 'Todos los centros'
              : 'Selecciona un almacen primero'
          }
          searchPlaceholder="Buscar centro..."
          disabled={!filterWarehouseId}
          className="max-w-xs"
        />
      </div>

      <DataTable
        columns={columns}
        data={workOrders}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay ordenes que coincidan con los filtros."
        emptyState={
          <EmptyState
            icon={FactoryIcon}
            title="No hay ordenes que coincidan con los filtros"
            description="Crea una para empezar."
            actionLabel="Nueva orden"
            onAction={openCreateDialog}
          />
        }
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nueva orden de trabajo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Receta</Label>
              <SearchableSelect
                value={formRecipeId || undefined}
                onValueChange={setFormRecipeId}
                options={recipes.map((r) => ({ value: r.id, label: r.name }))}
                placeholder="Seleccionar receta"
                searchPlaceholder="Buscar receta..."
              />
              {selectedRecipe && selectedRecipe.items.length > 0 && (
                <div
                  className="rounded-3xl border bg-muted/30 p-3"
                  data-testid="recipe-preview"
                >
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Ingredientes de la receta
                  </p>
                  <ul className="space-y-1 text-sm">
                    {selectedRecipe.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between"
                      >
                        <span>
                          <span className="font-medium">
                            {item.product_name}
                          </span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {item.product_sku}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {item.quantity} {item.unit_of_measure}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Producto terminado</Label>
                <SearchableSelect
                  value={formFgProductId || undefined}
                  onValueChange={setFormFgProductId}
                  options={products.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.sku})`,
                  }))}
                  placeholder="Seleccionar FG"
                  searchPlaceholder="Buscar producto..."
                />
                {products.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No hay productos marcados como manufacturables. Crea o
                    habilita uno en la pagina de Productos.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="fg-quantity">Cantidad</Label>
                <Input
                  id="fg-quantity"
                  type="number"
                  min={0.01}
                  step="any"
                  value={formFgQuantity}
                  onChange={(e) => setFormFgQuantity(e.target.value)}
                  required
                  data-testid="fg-quantity-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Almacen</Label>
                <SearchableSelect
                  value={formWarehouseId || undefined}
                  onValueChange={(val) => {
                    setFormWarehouseId(val);
                    setFormWorkCenterId('');
                  }}
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label: w.name,
                  }))}
                  placeholder="Seleccionar almacen"
                  searchPlaceholder="Buscar almacen..."
                />
              </div>
              <div className="space-y-2">
                <Label>Centro de trabajo</Label>
                <SearchableSelect
                  value={formWorkCenterId || undefined}
                  onValueChange={setFormWorkCenterId}
                  options={formWorkCenterLocations.map((l) => ({
                    value: l.id,
                    label: l.name,
                  }))}
                  placeholder={
                    formWarehouseId
                      ? 'Seleccionar centro'
                      : 'Selecciona un almacen primero'
                  }
                  searchPlaceholder="Buscar centro..."
                  disabled={!formWarehouseId}
                />
                {formWarehouseId &&
                  formWorkCenterLocations.length === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Este almacen no tiene centros de trabajo. Crea uno
                      antes de continuar.
                    </p>
                  )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wo-notes">Notas (opcional)</Label>
              <Textarea
                id="wo-notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Notas internas para el equipo"
                rows={2}
                data-testid="wo-notes-input"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit || isSaving}
                data-testid="submit-work-order-btn"
              >
                {isSaving ? 'Creando...' : 'Crear orden'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OrdenesDeTrabajoPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <OrdenesDeTrabajoPageInner />
    </Suspense>
  );
}
