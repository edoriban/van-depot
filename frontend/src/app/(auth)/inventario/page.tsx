'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  InventoryItem,
  Warehouse,
  Location,
  PaginatedResponse,
  ProductLot,
} from '@/types';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardIcon } from '@hugeicons/core-free-icons';
import { ExportButton } from '@/components/shared/export-button';
import { exportToExcel } from '@/lib/export-utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PER_PAGE = 20;

type StockFilter = 'all' | 'low' | 'critical';

function StockBadge({ quantity, minStock }: { quantity: number; minStock: number }) {
  if (quantity === 0) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="stock-badge-critical">
        Critico ({quantity}/{minStock})
      </Badge>
    );
  }
  if (minStock > 0 && quantity <= minStock) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="stock-badge-low">
        Bajo ({quantity}/{minStock})
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="stock-badge-ok">
      OK ({quantity}/{minStock})
    </Badge>
  );
}

function QualityBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
    pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
    rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
    quarantine: { label: 'Cuarentena', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  };
  const info = map[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return <Badge className={info.className}>{info.label}</Badge>;
}

interface LotsData {
  lots: ProductLot[];
  isLoading: boolean;
  error: string | null;
}

export default function InventoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterWarehouseId, setFilterWarehouseId] = useState('');
  const [filterLocationId, setFilterLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  // Expandable rows
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [lotsCache, setLotsCache] = useState<Record<string, LotsData>>({});

  // Fetch warehouses for filter
  useEffect(() => {
    api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => {
        setWarehouses(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {});
  }, []);

  // Fetch locations when warehouse changes
  useEffect(() => {
    if (!filterWarehouseId) {
      setLocations([]);
      setFilterLocationId('');
      return;
    }
    api
      .get<Location[] | PaginatedResponse<Location>>(
        `/warehouses/${filterWarehouseId}/locations`
      )
      .then((res) => {
        setLocations(Array.isArray(res) ? res : res.data);
      })
      .catch(() => setLocations([]));
  }, [filterWarehouseId]);

  const fetchInventory = useCallback(
    async (
      p: number,
      warehouseId: string,
      locationId: string,
      searchTerm: string,
      filter: StockFilter
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(p),
          per_page: String(PER_PAGE),
        });
        if (warehouseId) params.set('warehouse_id', warehouseId);
        if (locationId) params.set('location_id', locationId);
        if (searchTerm) params.set('search', searchTerm);
        if (filter === 'low') params.set('low_stock', 'true');
        const res = await api.get<PaginatedResponse<InventoryItem>>(
          `/inventory?${params}`
        );
        setItems(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error al cargar inventario'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchInventory(
      page,
      filterWarehouseId,
      filterLocationId,
      search,
      stockFilter
    );
  }, [page, filterWarehouseId, filterLocationId, search, stockFilter, fetchInventory]);

  // Fetch lots for a product when expanding
  const fetchLots = useCallback(async (item: InventoryItem) => {
    const cacheKey = `${item.product_id}_${item.location_id}`;
    if (lotsCache[cacheKey] && !lotsCache[cacheKey].error) return;

    setLotsCache((prev) => ({
      ...prev,
      [cacheKey]: { lots: [], isLoading: true, error: null },
    }));

    try {
      const res = await api.get<PaginatedResponse<ProductLot> | ProductLot[]>(
        `/products/${item.product_id}/lots`
      );
      const lots = Array.isArray(res) ? res : res.data;
      setLotsCache((prev) => ({
        ...prev,
        [cacheKey]: { lots, isLoading: false, error: null },
      }));
    } catch {
      setLotsCache((prev) => ({
        ...prev,
        [cacheKey]: { lots: [], isLoading: false, error: 'Error al cargar lotes' },
      }));
    }
  }, [lotsCache]);

  const handleToggleExpand = (item: InventoryItem) => {
    const itemKey = `${item.product_id}_${item.location_id}`;
    if (expandedItemId === itemKey) {
      setExpandedItemId(null);
    } else {
      setExpandedItemId(itemKey);
      fetchLots(item);
    }
  };

  const handleWarehouseChange = (value: string) => {
    setFilterWarehouseId(value);
    setFilterLocationId('');
    setPage(1);
  };

  const handleLocationChange = (value: string) => {
    setFilterLocationId(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStockFilterChange = (value: StockFilter) => {
    setStockFilter(value);
    setPage(1);
  };

  // Client-side filter for 'critical' (quantity === 0)
  const filteredItems = stockFilter === 'critical'
    ? items.filter((item) => item.quantity === 0)
    : items;

  const totalPages = Math.ceil(total / PER_PAGE);
  const COL_COUNT = 7;

  const handleExport = () => {
    exportToExcel(
      filteredItems as unknown as Record<string, unknown>[],
      'inventario',
      'Inventario',
      [
        { key: 'product_name', label: 'Producto' },
        { key: 'product_sku', label: 'SKU' },
        { key: 'location_name', label: 'Ubicacion' },
        {
          key: 'warehouse_id',
          label: 'Almacen',
          format: (_v, row) => {
            const r = row as unknown as InventoryItem;
            const wh = warehouses.find((w) => w.id === r.warehouse_id);
            return wh ? wh.name : r.warehouse_id;
          },
        },
        { key: 'quantity', label: 'Cantidad' },
        { key: 'min_stock', label: 'Stock minimo' },
        {
          key: 'quantity',
          label: 'Estado stock',
          format: (_v, row) => {
            const r = row as unknown as InventoryItem;
            if (r.quantity === 0) return 'Critico';
            if (r.min_stock > 0 && r.quantity <= r.min_stock) return 'Bajo';
            return 'OK';
          },
        },
      ]
    );
  };

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-muted-foreground mt-1">
            Vista de stock actual por producto y ubicacion
          </p>
        </div>
        <ExportButton onExport={handleExport} disabled={filteredItems.length === 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="filter-warehouse" className="text-sm">
            Almacen
          </Label>
          <Select
            value={filterWarehouseId || 'all'}
            onValueChange={(val) => handleWarehouseChange(val === 'all' ? '' : val)}
          >
            <SelectTrigger data-testid="filter-warehouse" className="w-48">
              <SelectValue placeholder="Todos los almacenes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los almacenes</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-location" className="text-sm">
            Ubicacion
          </Label>
          <Select
            value={filterLocationId || 'all'}
            onValueChange={(val) => handleLocationChange(val === 'all' ? '' : val)}
            disabled={!filterWarehouseId}
          >
            <SelectTrigger data-testid="filter-location" className="w-48">
              <SelectValue placeholder="Todas las ubicaciones" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las ubicaciones</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.label ? ` (${l.label})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="search-product" className="text-sm">
            Buscar producto
          </Label>
          <Input
            id="search-product"
            placeholder="Nombre o SKU..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-56"
            data-testid="search-product"
          />
        </div>

        {/* Stock filter buttons */}
        <div className="flex items-center gap-2 pb-0.5">
          <Button
            variant={stockFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStockFilterChange('all')}
            data-testid="filter-all"
          >
            Todos
          </Button>
          <Button
            variant={stockFilter === 'low' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStockFilterChange('low')}
            data-testid="filter-low"
          >
            Stock bajo
          </Button>
          <Button
            variant={stockFilter === 'critical' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStockFilterChange('critical')}
            data-testid="filter-critical"
          >
            Sin stock
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table — all three states rendered simultaneously; opacity crossfades between them */}
      <div className="relative" style={{ minHeight: '320px' }}>
        {/* Skeleton — visible while loading */}
        <div
          className="transition-opacity duration-200 ease-in-out"
          style={{
            opacity: isLoading ? 1 : 0,
            pointerEvents: isLoading ? 'auto' : 'none',
            position: 'absolute',
            inset: 0,
          }}
        >
          <div className="space-y-3">
            <div className="rounded-4xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Producto</TableHead>
                    <TableHead>Ubicacion</TableHead>
                    <TableHead>Almacen</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Stock min</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: COL_COUNT + 1 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Content area — fades in when not loading */}
        <div
          className="transition-opacity duration-200 ease-in-out"
          style={{
            opacity: isLoading ? 0 : 1,
            pointerEvents: isLoading ? 'none' : 'auto',
          }}
        >
          {/* Empty state — crossfades with table */}
          <div
            className="transition-opacity duration-150 ease-in-out"
            style={{
              opacity: filteredItems.length === 0 ? 1 : 0,
              pointerEvents: filteredItems.length === 0 ? 'auto' : 'none',
              position: filteredItems.length === 0 ? 'relative' : 'absolute',
              inset: 0,
            }}
          >
            <EmptyState
              icon={ClipboardIcon}
              title="No hay inventario registrado"
              description="Registra una entrada de material para ver el stock aqui."
              actionLabel="Ir a movimientos"
              actionHref="/movimientos"
            />
          </div>

          {/* Table with results — crossfades with empty state */}
          <div
            className="transition-opacity duration-150 ease-in-out"
            style={{
              opacity: filteredItems.length > 0 ? 1 : 0,
              pointerEvents: filteredItems.length > 0 ? 'auto' : 'none',
              position: filteredItems.length > 0 ? 'relative' : 'absolute',
              inset: 0,
            }}
          >
            <div className="space-y-4">
              <div className="rounded-4xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Producto</TableHead>
                      <TableHead>Ubicacion</TableHead>
                      <TableHead>Almacen</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>Stock min</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => {
                      const itemKey = `${item.product_id}_${item.location_id}`;
                      const isExpanded = expandedItemId === itemKey;
                      const lotsData = lotsCache[itemKey];
                      const wh = warehouses.find((w) => w.id === item.warehouse_id);

                      return (
                        <Fragment key={itemKey}>
                          <TableRow
                            className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                              item.quantity === 0
                                ? 'border-l-4 border-l-red-500'
                                : item.quantity <= item.min_stock && item.min_stock > 0
                                  ? 'border-l-4 border-l-amber-500'
                                  : ''
                            } ${isExpanded ? 'bg-muted/30' : ''}`}
                            onClick={() => handleToggleExpand(item)}
                          >
                            <TableCell className="w-8 text-center">
                              <span className="text-muted-foreground text-sm">
                                {isExpanded ? '\u25BC' : '\u25B6'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div>
                                <Link
                                  href={`/productos/${item.product_id}`}
                                  className="font-bold text-foreground hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {item.product_name}
                                </Link>
                                <span className="ml-2 font-mono text-sm text-muted-foreground">
                                  {item.product_sku}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{item.location_name}</TableCell>
                            <TableCell>{wh ? wh.name : item.warehouse_id}</TableCell>
                            <TableCell>
                              <span className="font-medium" data-testid="inventory-quantity">
                                {item.quantity}
                              </span>
                            </TableCell>
                            <TableCell>{item.min_stock}</TableCell>
                            <TableCell>
                              <StockBadge quantity={item.quantity} minStock={item.min_stock} />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    data-testid="inventory-actions-btn"
                                  >
                                    <span className="sr-only">Abrir menu</span>
                                    <span className="text-lg leading-none">...</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => router.push(`/movimientos?tab=entry&product=${item.product_id}`)}
                                  >
                                    Registrar entrada
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => router.push(`/movimientos?tab=adjustment&product=${item.product_id}`)}
                                  >
                                    Ajustar inventario
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => router.push(`/productos/${item.product_id}`)}
                                  >
                                    Ver producto
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => router.push(`/productos/${item.product_id}?tab=movimientos`)}
                                  >
                                    Ver movimientos
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>

                          {/* Expanded lots row — always in DOM for smooth CSS grid animation */}
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={COL_COUNT + 1} className="p-0">
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateRows: isExpanded ? '1fr' : '0fr',
                                  transition: 'grid-template-rows 300ms ease',
                                }}
                              >
                                <div style={{ overflow: 'hidden' }}>
                                  <div className="px-6 py-4 pl-12">
                                    {lotsData?.isLoading ? (
                                      <div className="space-y-2">
                                        <Skeleton className="h-4 w-64" />
                                        <Skeleton className="h-4 w-48" />
                                      </div>
                                    ) : lotsData?.error ? (
                                      <p className="text-sm text-destructive">{lotsData.error}</p>
                                    ) : lotsData && lotsData.lots.length > 0 ? (
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2 mb-3">
                                          <span className="text-sm font-semibold text-foreground">
                                            Lotes ({lotsData.lots.length})
                                          </span>
                                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                            Con lotes
                                          </Badge>
                                        </div>
                                        <div className="rounded-2xl border bg-background">
                                          <Table>
                                            <TableHeader>
                                              <TableRow>
                                                <TableHead className="text-xs">Lote</TableHead>
                                                <TableHead className="text-xs">Cantidad recibida</TableHead>
                                                <TableHead className="text-xs">Cantidad total</TableHead>
                                                <TableHead className="text-xs">Vencimiento</TableHead>
                                                <TableHead className="text-xs">Calidad</TableHead>
                                                <TableHead className="text-xs">Notas</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {lotsData.lots.map((lot) => (
                                                <TableRow key={lot.id}>
                                                  <TableCell className="font-mono text-sm">
                                                    {lot.lot_number}
                                                  </TableCell>
                                                  <TableCell className="text-sm">
                                                    {lot.received_quantity}
                                                  </TableCell>
                                                  <TableCell className="text-sm font-medium">
                                                    {lot.total_quantity}
                                                  </TableCell>
                                                  <TableCell className="text-sm">
                                                    {lot.expiration_date
                                                      ? new Date(lot.expiration_date).toLocaleDateString('es-MX')
                                                      : '-'}
                                                  </TableCell>
                                                  <TableCell>
                                                    <QualityBadge status={lot.quality_status} />
                                                  </TableCell>
                                                  <TableCell className="text-sm text-muted-foreground">
                                                    {lot.notes ?? '-'}
                                                  </TableCell>
                                                </TableRow>
                                              ))}
                                            </TableBody>
                                          </Table>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">
                                        Stock registrado sin lotes
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {(page - 1) * PER_PAGE + 1}-{Math.min(page * PER_PAGE, total)} de {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page <= 1}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= totalPages}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
