'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type { Warehouse, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

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

  const columns: ColumnDef<Warehouse>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (w) => <span className="font-medium">{w.name}</span>,
    },
    {
      key: 'address',
      header: 'Direccion',
      render: (w) => w.address || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (w) => (
        <Badge variant={w.is_active ? 'default' : 'secondary'}>
          {w.is_active ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (w) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(w)}
            data-testid="edit-warehouse-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(w)}
            data-testid="delete-warehouse-btn"
          >
            Eliminar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
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

      <DataTable
        columns={columns}
        data={warehouses}
        total={total}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay almacenes registrados"
      />

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
  );
}
