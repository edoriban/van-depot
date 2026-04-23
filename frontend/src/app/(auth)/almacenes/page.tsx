'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api-mutations';
import type { Warehouse, WarehouseWithStats, PaginatedResponse } from '@/types';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Store01Icon,
  PencilEdit01Icon,
  Delete01Icon,
} from '@hugeicons/core-free-icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import Link from 'next/link';
import { PageTransition } from '@/components/shared/page-transition';

// --- Helpers ---

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function healthPercent(w: WarehouseWithStats): number {
  if (w.products_count === 0) return 100;
  return Math.round(
    ((w.products_count - w.low_stock_count - w.critical_count) /
      w.products_count) *
      100
  );
}

function healthColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function healthLabel(pct: number): string {
  if (pct >= 80) return 'Buena';
  if (pct >= 50) return 'Regular';
  return 'Critica';
}

// --- Component ---

export default function AlmacenesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseWithStats[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchWarehouses = async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<WarehouseWithStats>>(
        `/warehouses/with-stats?page=${p}&per_page=${perPage}`
      );
      setWarehouses(res.data);
      setTotal(res.total);
    } catch {
      // Fallback to basic endpoint if with-stats is not available
      try {
        const res = await api.get<PaginatedResponse<Warehouse>>(
          `/warehouses?page=${p}&per_page=${perPage}`
        );
        const fallback: WarehouseWithStats[] = res.data.map((w) => ({
          ...w,
          locations_count: 0,
          products_count: 0,
          total_quantity: 0,
          low_stock_count: 0,
          critical_count: 0,
          last_movement_at: null,
        }));
        setWarehouses(fallback);
        setTotal(res.total);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error al cargar almacenes'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWarehouses(page);
  }, [page]);

  const filtered = useMemo(() => {
    if (!search.trim()) return warehouses;
    const q = search.toLowerCase();
    return warehouses.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.address && w.address.toLowerCase().includes(q))
    );
  }, [warehouses, search]);

  const openCreateDialog = () => {
    setEditingWarehouse(null);
    setFormName('');
    setFormAddress('');
    setFormOpen(true);
  };

  const openEditDialog = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    setFormName(warehouse.name);
    setFormAddress(warehouse.address ?? '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingWarehouse) {
        await api.put(`/warehouses/${editingWarehouse.id}`, {
          name: formName,
          address: formAddress || undefined,
        });
      } else {
        await api.post('/warehouses', {
          name: formName,
          address: formAddress || undefined,
        });
      }
      setFormOpen(false);
      fetchWarehouses(editingWarehouse ? page : 1);
      if (!editingWarehouse) setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.del(`/warehouses/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchWarehouses(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalProducts = warehouses.reduce((s, w) => s + w.products_count, 0);
    const totalCritical = warehouses.reduce((s, w) => s + w.critical_count, 0);
    const totalLow = warehouses.reduce((s, w) => s + w.low_stock_count, 0);
    const totalLocations = warehouses.reduce(
      (s, w) => s + w.locations_count,
      0
    );
    return { totalProducts, totalCritical, totalLow, totalLocations };
  }, [warehouses]);

  return (
    <PageTransition>
      <div className="space-y-6" data-testid="almacenes-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Almacenes</h1>
            <p className="text-muted-foreground mt-1">
              Gestiona los almacenes de tu organizacion
            </p>
          </div>
          <Button onClick={openCreateDialog} data-testid="new-warehouse-btn">
            Nuevo almacen
          </Button>
        </div>

        {error && (
          <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Summary stats bar */}
        {!isLoading && warehouses.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">{warehouses.length}</p>
              <p className="text-xs text-muted-foreground">Almacenes</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">
                {summaryStats.totalLocations}
              </p>
              <p className="text-xs text-muted-foreground">Ubicaciones</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">
                {summaryStats.totalProducts}
              </p>
              <p className="text-xs text-muted-foreground">Productos</p>
            </div>
            {summaryStats.totalCritical > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {summaryStats.totalCritical}
                </p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  Criticos
                </p>
              </div>
            ) : (
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  0
                </p>
                <p className="text-xs text-muted-foreground">Criticos</p>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {!isLoading && warehouses.length > 0 && (
          <div className="max-w-sm">
            <Input
              placeholder="Buscar almacen por nombre o direccion..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="warehouse-search"
            />
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <div className="h-5 skeleton-shimmer rounded w-2/3" />
                  <div className="h-4 skeleton-shimmer rounded w-1/2 mt-2" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div
                        key={j}
                        className="h-12 skeleton-shimmer rounded"
                      />
                    ))}
                  </div>
                  <div className="h-3 skeleton-shimmer rounded w-full" />
                  <div className="h-4 skeleton-shimmer rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : warehouses.length === 0 ? (
          <EmptyState
            icon={Store01Icon}
            title="Aun no tienes almacenes"
            description="Crea tu primer almacen para organizar tu inventario."
            actionLabel="Nuevo almacen"
            onAction={openCreateDialog}
          />
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">Sin resultados</p>
            <p className="text-sm mt-1">
              No se encontraron almacenes que coincidan con &quot;{search}&quot;
            </p>
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              data-testid="warehouse-grid"
            >
              {filtered.map((warehouse, i) => {
                const health = healthPercent(warehouse);
                const hasStats = warehouse.products_count > 0;

                return (
                  <Card
                    key={warehouse.id}
                    className="animate-fade-in-up hover:border-primary/50 transition-colors relative"
                    style={{ animationDelay: `${i * 50}ms` }}
                    data-testid="warehouse-card"
                  >
                    {/* Alert badges - top right corner */}
                    {warehouse.critical_count > 0 && (
                      <div className="absolute -top-2 -right-2 z-10">
                        <Badge className="bg-red-600 text-white text-xs shadow-md">
                          {warehouse.critical_count} critico
                          {warehouse.critical_count !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    )}

                    <CardHeader>
                      <div className="flex flex-row items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-lg">
                            <Link
                              href={`/almacenes/${warehouse.id}`}
                              className="hover:underline"
                              data-testid="warehouse-detail-link"
                            >
                              {warehouse.name}
                            </Link>
                          </CardTitle>
                          <CardDescription>
                            {warehouse.address || 'Sin direccion'}
                          </CardDescription>
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          <Badge
                            variant={
                              warehouse.is_active ? 'default' : 'secondary'
                            }
                          >
                            {warehouse.is_active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>
                      </div>
                      <CardAction>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditDialog(warehouse);
                            }}
                            data-testid="edit-warehouse-btn"
                          >
                            <HugeiconsIcon icon={PencilEdit01Icon} size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(warehouse);
                            }}
                            data-testid="delete-warehouse-btn"
                          >
                            <HugeiconsIcon icon={Delete01Icon} size={16} />
                          </Button>
                        </div>
                      </CardAction>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Stats grid */}
                      <div className="grid grid-cols-4 gap-2">
                        <div className="rounded-md bg-muted/50 p-2 text-center">
                          <p className="text-lg font-bold leading-none">
                            {warehouse.locations_count}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Ubic.
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-2 text-center">
                          <p className="text-lg font-bold leading-none">
                            {warehouse.products_count}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Prod.
                          </p>
                        </div>
                        <div
                          className={`rounded-md p-2 text-center ${
                            warehouse.low_stock_count > 0
                              ? 'bg-amber-50 dark:bg-amber-950'
                              : 'bg-muted/50'
                          }`}
                        >
                          <p
                            className={`text-lg font-bold leading-none ${
                              warehouse.low_stock_count > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : ''
                            }`}
                          >
                            {warehouse.low_stock_count}
                          </p>
                          <p
                            className={`text-[10px] mt-1 ${
                              warehouse.low_stock_count > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            Bajos
                          </p>
                        </div>
                        <div
                          className={`rounded-md p-2 text-center ${
                            warehouse.critical_count > 0
                              ? 'bg-red-50 dark:bg-red-950'
                              : 'bg-muted/50'
                          }`}
                        >
                          <p
                            className={`text-lg font-bold leading-none ${
                              warehouse.critical_count > 0
                                ? 'text-red-600 dark:text-red-400'
                                : ''
                            }`}
                          >
                            {warehouse.critical_count}
                          </p>
                          <p
                            className={`text-[10px] mt-1 ${
                              warehouse.critical_count > 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            Crit.
                          </p>
                        </div>
                      </div>

                      {/* Health bar */}
                      {hasStats && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Salud del inventario
                            </span>
                            <span
                              className={`font-medium ${
                                health >= 80
                                  ? 'text-green-600 dark:text-green-400'
                                  : health >= 50
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {health}% {healthLabel(health)}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${healthColor(health)}`}
                              style={{ width: `${health}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {!hasStats && (
                        <p className="text-xs text-muted-foreground italic">
                          Sin productos registrados
                        </p>
                      )}

                      {/* Last movement */}
                      <p className="text-xs text-muted-foreground">
                        {warehouse.last_movement_at
                          ? `Ultimo movimiento: ${timeAgo(warehouse.last_movement_at)}`
                          : 'Sin actividad registrada'}
                      </p>

                      {/* Footer link */}
                      <div className="pt-1 border-t">
                        <Link
                          href={`/almacenes/${warehouse.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                          data-testid="warehouse-view-link"
                        >
                          Ver almacen →
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-center gap-2"
                data-testid="pagination"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground">
                  Pagina {page} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Siguiente
                </Button>
              </div>
            )}
          </>
        )}

        {/* Create / Edit Dialog */}
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingWarehouse ? 'Editar almacen' : 'Nuevo almacen'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="warehouse-name">Nombre</Label>
                <Input
                  id="warehouse-name"
                  name="name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Nombre del almacen"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouse-address">Direccion</Label>
                <Input
                  id="warehouse-address"
                  name="address"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="Direccion del almacen (opcional)"
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
                  disabled={isSaving}
                  data-testid="submit-btn"
                >
                  {isSaving
                    ? 'Guardando...'
                    : editingWarehouse
                      ? 'Actualizar'
                      : 'Crear'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Eliminar almacen"
          description={`Se eliminara el almacen "${deleteTarget?.name}". Esta accion no se puede deshacer.`}
          onConfirm={handleDelete}
          isLoading={isDeleting}
        />
      </div>
    </PageTransition>
  );
}
