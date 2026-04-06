'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/features/auth/api';
import type { Supplier, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function ProveedoresPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formName, setFormName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchSuppliers = useCallback(async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<Supplier>>(
        `/suppliers?page=${p}&per_page=${perPage}`
      );
      setSuppliers(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar proveedores');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers(page);
  }, [page, fetchSuppliers]);

  const openCreateDialog = () => {
    setEditingSupplier(null);
    setFormName('');
    setFormContactName('');
    setFormPhone('');
    setFormEmail('');
    setFormOpen(true);
  };

  const openEditDialog = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormName(supplier.name);
    setFormContactName(supplier.contact_name ?? '');
    setFormPhone(supplier.phone ?? '');
    setFormEmail(supplier.email ?? '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const body = {
        name: formName,
        contact_name: formContactName || undefined,
        phone: formPhone || undefined,
        email: formEmail || undefined,
      };
      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier.id}`, body);
      } else {
        await api.post('/suppliers', body);
      }
      setFormOpen(false);
      fetchSuppliers(editingSupplier ? page : 1);
      if (!editingSupplier) setPage(1);
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
      await api.del(`/suppliers/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchSuppliers(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: ColumnDef<Supplier>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (s) => <span className="font-medium">{s.name}</span>,
    },
    {
      key: 'contact_name',
      header: 'Contacto',
      render: (s) =>
        s.contact_name || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'phone',
      header: 'Telefono',
      render: (s) =>
        s.phone || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (s) =>
        s.email || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (s) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(s)}
            data-testid="edit-supplier-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(s)}
            data-testid="delete-supplier-btn"
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
          <h1 className="text-2xl font-bold">Proveedores</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los proveedores de tu organizacion
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-supplier-btn">
          Nuevo proveedor
        </Button>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={suppliers}
        total={total}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay proveedores registrados"
      />

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Nombre</Label>
              <Input
                id="supplier-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre del proveedor"
                required
                data-testid="supplier-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-contact">Nombre de contacto</Label>
              <Input
                id="supplier-contact"
                name="contact_name"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
                placeholder="Nombre del contacto (opcional)"
                data-testid="supplier-contact-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier-phone">Telefono</Label>
                <Input
                  id="supplier-phone"
                  name="phone"
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Telefono (opcional)"
                  data-testid="supplier-phone-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-email">Email</Label>
                <Input
                  id="supplier-email"
                  name="email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Email (opcional)"
                  data-testid="supplier-email-input"
                />
              </div>
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
                {isSaving ? 'Guardando...' : editingSupplier ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar proveedor"
        description={`Se eliminara el proveedor "${deleteTarget?.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
