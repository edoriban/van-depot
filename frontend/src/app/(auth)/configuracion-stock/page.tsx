'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { StockConfig, Product, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Settings01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

export default function ConfiguracionStockPage() {
  // Global config
  const [globalConfig, setGlobalConfig] = useState<StockConfig | null>(null);
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(true);

  // Product overrides
  const [overrides, setOverrides] = useState<(StockConfig & { product_name?: string; product_sku?: string })[]>([]);
  const [overridesTotal, setOverridesTotal] = useState(0);
  const [overridesPage, setOverridesPage] = useState(1);
  const [isLoadingOverrides, setIsLoadingOverrides] = useState(true);

  // Products for selector
  const [products, setProducts] = useState<Product[]>([]);

  // Edit global dialog
  const [editGlobalOpen, setEditGlobalOpen] = useState(false);
  const [editMinStock, setEditMinStock] = useState('');
  const [editCriticalMultiplier, setEditCriticalMultiplier] = useState('');
  const [editLowMultiplier, setEditLowMultiplier] = useState('');
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);

  // Add override dialog
  const [addOverrideOpen, setAddOverrideOpen] = useState(false);
  const [overrideProductId, setOverrideProductId] = useState('');
  const [overrideMinStock, setOverrideMinStock] = useState('');
  const [overrideCriticalMultiplier, setOverrideCriticalMultiplier] = useState('');
  const [overrideLowMultiplier, setOverrideLowMultiplier] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  // Delete override
  const [deleteOverride, setDeleteOverride] = useState<StockConfig | null>(null);
  const [isDeletingOverride, setIsDeletingOverride] = useState(false);

  const PER_PAGE = 20;

  const fetchGlobalConfig = useCallback(async () => {
    setIsLoadingGlobal(true);
    try {
      const res = await api.get<StockConfig>('/stock-config/global');
      setGlobalConfig(res);
    } catch {
      // May not exist yet
      setGlobalConfig(null);
    } finally {
      setIsLoadingGlobal(false);
    }
  }, []);

  const fetchOverrides = useCallback(async (p: number) => {
    setIsLoadingOverrides(true);
    try {
      const res = await api.get<PaginatedResponse<StockConfig & { product_name?: string; product_sku?: string }>>(
        `/stock-config/overrides?page=${p}&per_page=${PER_PAGE}`
      );
      setOverrides(res.data);
      setOverridesTotal(res.total);
    } catch {
      setOverrides([]);
      setOverridesTotal(0);
    } finally {
      setIsLoadingOverrides(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get<Product[] | PaginatedResponse<Product>>('/products');
      setProducts(Array.isArray(res) ? res : res.data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchGlobalConfig();
    fetchOverrides(overridesPage);
    fetchProducts();
  }, [fetchGlobalConfig, fetchOverrides, fetchProducts, overridesPage]);

  const openEditGlobal = () => {
    if (globalConfig) {
      setEditMinStock(String(globalConfig.default_min_stock));
      setEditCriticalMultiplier(String(Math.round(globalConfig.critical_stock_multiplier * 100)));
      setEditLowMultiplier(String(Math.round(globalConfig.low_stock_multiplier * 100)));
    } else {
      setEditMinStock('10');
      setEditCriticalMultiplier('25');
      setEditLowMultiplier('50');
    }
    setEditGlobalOpen(true);
  };

  const handleSaveGlobal = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSavingGlobal(true);
    try {
      const body = {
        default_min_stock: Number(editMinStock),
        critical_stock_multiplier: Number(editCriticalMultiplier) / 100,
        low_stock_multiplier: Number(editLowMultiplier) / 100,
      };
      if (globalConfig) {
        await api.put(`/stock-config/${globalConfig.id}`, body);
      } else {
        await api.post('/stock-config', body);
      }
      toast.success('Configuracion global actualizada');
      setEditGlobalOpen(false);
      fetchGlobalConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar configuracion');
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleAddOverride = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSavingOverride(true);
    try {
      await api.post('/stock-config', {
        product_id: overrideProductId,
        default_min_stock: Number(overrideMinStock),
        critical_stock_multiplier: Number(overrideCriticalMultiplier) / 100,
        low_stock_multiplier: Number(overrideLowMultiplier) / 100,
      });
      toast.success('Configuracion de producto creada');
      setAddOverrideOpen(false);
      setOverrideProductId('');
      setOverrideMinStock('');
      setOverrideCriticalMultiplier('');
      setOverrideLowMultiplier('');
      fetchOverrides(overridesPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear configuracion');
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleDeleteOverride = async () => {
    if (!deleteOverride) return;
    setIsDeletingOverride(true);
    try {
      await api.del(`/stock-config/${deleteOverride.id}`);
      toast.success('Configuracion eliminada');
      setDeleteOverride(null);
      fetchOverrides(overridesPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeletingOverride(false);
    }
  };

  const overrideColumns: ColumnDef<StockConfig & { product_name?: string; product_sku?: string }>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (c) => (
        <div>
          <span className="font-medium">{c.product_name ?? '-'}</span>
          {c.product_sku && (
            <span className="ml-2 font-mono text-sm text-muted-foreground">{c.product_sku}</span>
          )}
        </div>
      ),
    },
    {
      key: 'min_stock',
      header: 'Stock minimo',
      render: (c) => c.default_min_stock,
    },
    {
      key: 'critical',
      header: 'Nivel critico (%)',
      render: (c) => `${Math.round(c.critical_stock_multiplier * 100)}%`,
    },
    {
      key: 'low',
      header: 'Nivel alerta baja (%)',
      render: (c) => `${Math.round(c.low_stock_multiplier * 100)}%`,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setDeleteOverride(c)}
        >
          Eliminar
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuracion de Stock</h1>
        <p className="text-muted-foreground mt-1">
          Define los umbrales globales y por producto para alertas de stock
        </p>
      </div>

      {/* Global Config Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Configuracion global</CardTitle>
          <Button variant="outline" size="sm" onClick={openEditGlobal}>
            {globalConfig ? 'Editar' : 'Configurar'}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingGlobal ? (
            <div className="space-y-2">
              <div className="h-4 w-48 rounded bg-muted animate-pulse" />
              <div className="h-4 w-36 rounded bg-muted animate-pulse" />
              <div className="h-4 w-36 rounded bg-muted animate-pulse" />
            </div>
          ) : globalConfig ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Stock minimo por defecto</p>
                <p className="text-2xl font-semibold">{globalConfig.default_min_stock}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nivel critico (% del stock minimo)</p>
                <p className="text-2xl font-semibold">{Math.round(globalConfig.critical_stock_multiplier * 100)}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nivel de alerta baja (% del stock minimo)</p>
                <p className="text-2xl font-semibold">{Math.round(globalConfig.low_stock_multiplier * 100)}%</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay configuracion global definida. Haz clic en "Configurar" para establecer los umbrales.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Product Overrides */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Configuracion por producto</h2>
          <Button size="sm" onClick={() => setAddOverrideOpen(true)}>
            Agregar producto
          </Button>
        </div>
        <DataTable
          columns={overrideColumns}
          data={overrides}
          total={overridesTotal}
          page={overridesPage}
          perPage={PER_PAGE}
          onPageChange={setOverridesPage}
          isLoading={isLoadingOverrides}
          emptyMessage="Sin configuraciones por producto"
          emptyState={
            <EmptyState
              icon={Settings01Icon}
              title="Sin configuraciones personalizadas"
              description="Agrega configuraciones especificas por producto para sobreescribir los valores globales."
              actionLabel="Agregar producto"
              onAction={() => setAddOverrideOpen(true)}
            />
          }
        />
      </div>

      {/* Edit Global Dialog */}
      <Dialog open={editGlobalOpen} onOpenChange={setEditGlobalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {globalConfig ? 'Editar configuracion global' : 'Crear configuracion global'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveGlobal} className="space-y-4">
            <div className="space-y-2">
              <Label>Stock minimo por defecto</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={editMinStock}
                onChange={(e) => setEditMinStock(e.target.value)}
                required
                placeholder="10"
              />
            </div>
            <div className="space-y-2">
              <Label>Nivel critico (% del stock minimo)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="1"
                value={editCriticalMultiplier}
                onChange={(e) => setEditCriticalMultiplier(e.target.value)}
                required
                placeholder="25"
              />
              <p className="text-xs text-muted-foreground">
                Ej: 25 = alerta critica cuando quede el 25% del stock minimo
              </p>
            </div>
            <div className="space-y-2">
              <Label>Nivel de alerta baja (% del stock minimo)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="1"
                value={editLowMultiplier}
                onChange={(e) => setEditLowMultiplier(e.target.value)}
                required
                placeholder="50"
              />
              <p className="text-xs text-muted-foreground">
                Ej: 50 = alerta cuando quede la mitad del stock minimo
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditGlobalOpen(false)} disabled={isSavingGlobal}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSavingGlobal}>
                {isSavingGlobal ? 'Guardando...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Override Dialog */}
      <Dialog open={addOverrideOpen} onOpenChange={setAddOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configuracion de producto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddOverride} className="space-y-4">
            <div className="space-y-2">
              <Label>Producto</Label>
              <SearchableSelect
                value={overrideProductId || undefined}
                onValueChange={setOverrideProductId}
                options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                placeholder="Seleccionar producto"
                searchPlaceholder="Buscar producto..."
              />
            </div>
            <div className="space-y-2">
              <Label>Stock minimo</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={overrideMinStock}
                onChange={(e) => setOverrideMinStock(e.target.value)}
                required
                placeholder="10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nivel critico (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={overrideCriticalMultiplier}
                  onChange={(e) => setOverrideCriticalMultiplier(e.target.value)}
                  required
                  placeholder="25"
                />
                <p className="text-xs text-muted-foreground">Ej: 25 = alerta critica al 25%</p>
              </div>
              <div className="space-y-2">
                <Label>Nivel alerta baja (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={overrideLowMultiplier}
                  onChange={(e) => setOverrideLowMultiplier(e.target.value)}
                  required
                  placeholder="50"
                />
                <p className="text-xs text-muted-foreground">Ej: 50 = alerta cuando quede la mitad</p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOverrideOpen(false)} disabled={isSavingOverride}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSavingOverride || !overrideProductId}>
                {isSavingOverride ? 'Guardando...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Override Confirmation */}
      <ConfirmDialog
        open={!!deleteOverride}
        onOpenChange={(open) => !open && setDeleteOverride(null)}
        title="Eliminar configuracion"
        description="Se eliminara la configuracion personalizada de este producto. Se usaran los valores globales."
        onConfirm={handleDeleteOverride}
        isLoading={isDeletingOverride}
      />
    </div>
  );
}
