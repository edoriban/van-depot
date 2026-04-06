'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type { Warehouse, PaginatedResponse } from '@/types';
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

export default function AlmacenesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const res = await api.get<PaginatedResponse<Warehouse>>(
        `/warehouses?page=${p}&per_page=${perPage}`
      );
      setWarehouses(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar almacenes');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWarehouses(page);
  }, [page]);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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

  return (
    <PageTransition>
    <div className="space-y-6" data-testid="almacenes-page">
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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-5 skeleton-shimmer rounded w-2/3" />
                <div className="h-4 skeleton-shimmer rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 skeleton-shimmer rounded w-1/3" />
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
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="warehouse-grid">
            {warehouses.map((warehouse, i) => (
              <Card
                key={warehouse.id}
                className="animate-fade-in-up hover:border-primary/50 transition-colors"
                style={{ animationDelay: `${i * 50}ms` }}
                data-testid="warehouse-card"
              >
                <CardHeader>
                  <div className="flex flex-row items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg">{warehouse.name}</CardTitle>
                      <CardDescription>
                        {warehouse.address || 'Sin direccion'}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Badge variant={warehouse.is_active ? 'default' : 'secondary'}>
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
                <CardContent>
                  <Link
                    href={`/almacenes/${warehouse.id}`}
                    className="text-sm text-primary hover:underline"
                    data-testid="warehouse-detail-link"
                  >
                    Ver ubicaciones e inventario →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2" data-testid="pagination">
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
              <Button type="submit" disabled={isSaving} data-testid="submit-btn">
                {isSaving ? 'Guardando...' : editingWarehouse ? 'Actualizar' : 'Crear'}
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
