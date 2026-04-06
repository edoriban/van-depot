'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-mutations';
import type { InventoryItem, Warehouse, Location, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClipboardIcon } from '@hugeicons/core-free-icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PER_PAGE = 20;

function StockBadge({ quantity, minStock }: { quantity: number; minStock: number }) {
  if (quantity === 0) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="stock-badge-critical">
        Critico ({quantity}/{minStock})
      </Badge>
    );
  }
  if (quantity <= minStock) {
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

export default function InventoryPage() {
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
  const [lowStockOnly, setLowStockOnly] = useState(false);

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
      lowStock: boolean
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
        if (searchTerm) params.set('product_id', searchTerm);
        if (lowStock) params.set('low_stock', 'true');
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
      lowStockOnly
    );
  }, [page, filterWarehouseId, filterLocationId, search, lowStockOnly, fetchInventory]);

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

  const handleLowStockToggle = () => {
    setLowStockOnly((prev) => !prev);
    setPage(1);
  };

  const columns: ColumnDef<InventoryItem>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (item) => (
        <div>
          <span className="font-medium">{item.product_name}</span>
          <span className="ml-2 font-mono text-sm text-muted-foreground">
            {item.product_sku}
          </span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Ubicacion',
      render: (item) => item.location_name,
    },
    {
      key: 'warehouse',
      header: 'Almacen',
      render: (item) => {
        const wh = warehouses.find((w) => w.id === item.warehouse_id);
        return wh ? wh.name : item.warehouse_id;
      },
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (item) => (
        <span className="font-medium" data-testid="inventory-quantity">
          {item.quantity}
        </span>
      ),
    },
    {
      key: 'min_stock',
      header: 'Stock min',
      render: (item) => item.min_stock,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item) => (
        <StockBadge quantity={item.quantity} minStock={item.min_stock} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) =>
        item.quantity <= item.min_stock ? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/movements">Registrar entrada</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div>
        <h1 className="text-2xl font-bold">Inventario</h1>
        <p className="text-muted-foreground mt-1">
          Vista de stock actual por producto y ubicacion
        </p>
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

        <div className="flex items-center gap-2 pb-0.5">
          <input
            type="checkbox"
            id="low-stock-toggle"
            checked={lowStockOnly}
            onChange={handleLowStockToggle}
            className="h-4 w-4 rounded border-gray-300"
            data-testid="low-stock-toggle"
          />
          <Label htmlFor="low-stock-toggle" className="text-sm cursor-pointer">
            Solo stock bajo
          </Label>
        </div>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={items}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        rowClassName={(item) =>
          item.quantity === 0
            ? 'border-l-4 border-l-red-500'
            : item.quantity <= item.min_stock
              ? 'border-l-4 border-l-amber-500'
              : ''
        }
        emptyMessage="No hay registros de inventario"
        emptyState={
          <EmptyState
            icon={ClipboardIcon}
            title="No hay inventario registrado"
            description="Registra una entrada de material para ver el stock aqui."
            actionLabel="Ir a movimientos"
            actionHref="/movements"
          />
        }
      />
    </div>
  );
}
