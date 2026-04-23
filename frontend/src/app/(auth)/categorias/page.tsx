'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { Category, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag01Icon } from '@hugeicons/core-free-icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function CategoriasPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchCategories = useCallback(async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<Category>>(
        `/categories?page=${p}&per_page=${perPage}`
      );
      setCategories(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar categorias');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAllCategories = useCallback(async () => {
    try {
      const res = await api.get<PaginatedResponse<Category>>(
        '/categories?page=1&per_page=100'
      );
      setAllCategories(res.data);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchAllCategories();
  }, [fetchAllCategories]);

  useEffect(() => {
    fetchCategories(page);
  }, [page, fetchCategories]);

  const getParentName = (parentId?: string) => {
    if (!parentId) return <span className="text-muted-foreground">&mdash;</span>;
    const parent = allCategories.find((c) => c.id === parentId);
    return parent ? parent.name : <span className="text-muted-foreground">&mdash;</span>;
  };

  const openCreateDialog = () => {
    setEditingCategory(null);
    setFormName('');
    setFormParentId('');
    setFormOpen(true);
  };

  const openEditDialog = (category: Category) => {
    setEditingCategory(category);
    setFormName(category.name);
    setFormParentId(category.parent_id ?? '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const body = {
        name: formName,
        parent_id: formParentId || undefined,
      };
      if (editingCategory) {
        await api.put(`/categories/${editingCategory.id}`, body);
      } else {
        await api.post('/categories', body);
      }
      setFormOpen(false);
      fetchCategories(editingCategory ? page : 1);
      fetchAllCategories();
      if (!editingCategory) setPage(1);
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
      await api.del(`/categories/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchCategories(page);
      fetchAllCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter out the current category from parent options (can't be its own parent)
  const parentOptions = allCategories.filter(
    (c) => c.id !== editingCategory?.id
  );

  const columns: ColumnDef<Category>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'parent',
      header: 'Padre',
      render: (c) => getParentName(c.parent_id),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (c) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(c)}
            data-testid="edit-category-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(c)}
            data-testid="delete-category-btn"
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
          <h1 className="text-2xl font-bold">Categorias</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona las categorias de productos
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-category-btn">
          Nueva categoria
        </Button>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={categories}
        total={total}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay categorias registradas"
        emptyState={
          <EmptyState
            icon={Tag01Icon}
            title="Aun no tienes categorias"
            description="Crea categorias para organizar tus productos."
            actionLabel="Nueva categoria"
            onAction={openCreateDialog}
          />
        }
      />

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? 'Editar categoria' : 'Nueva categoria'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Nombre</Label>
              <Input
                id="category-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre de la categoria"
                required
                data-testid="category-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-parent">Categoria padre</Label>
              <Select
                value={formParentId || 'none'}
                onValueChange={(val) => setFormParentId(val === 'none' ? '' : val)}
              >
                <SelectTrigger data-testid="category-parent-select" className="w-full">
                  <SelectValue placeholder="Sin categoria padre" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoria padre</SelectItem>
                  {parentOptions.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {isSaving ? 'Guardando...' : editingCategory ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar categoria"
        description={`Se eliminara la categoria "${deleteTarget?.name}". Si tiene subcategorias o productos asociados, podrian verse afectados.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
