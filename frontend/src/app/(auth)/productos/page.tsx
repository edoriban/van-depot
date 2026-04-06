'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { Product, Category, PaginatedResponse, UnitType } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const UNIT_LABELS: Record<UnitType, string> = {
  piece: 'Pieza',
  kg: 'Kilogramo',
  gram: 'Gramo',
  liter: 'Litro',
  ml: 'Mililitro',
  meter: 'Metro',
  cm: 'Centimetro',
  box: 'Caja',
  pack: 'Paquete',
};

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formUnit, setFormUnit] = useState<UnitType>('piece');
  const [formMinStock, setFormMinStock] = useState('0');
  const [formMaxStock, setFormMaxStock] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchProducts = useCallback(async (p: number, s: string, catId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/products?page=${p}&per_page=${perPage}`;
      if (s) url += `&search=${encodeURIComponent(s)}`;
      if (catId) url += `&category_id=${catId}`;
      const res = await api.get<PaginatedResponse<Product>>(url);
      setProducts(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar productos');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<PaginatedResponse<Category>>(
        '/categories?page=1&per_page=100'
      );
      setCategories(res.data);
    } catch {
      // Categories are optional for display
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchProducts(page, search, filterCategoryId);
  }, [page, search, filterCategoryId, fetchProducts]);

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return <span className="text-muted-foreground">-</span>;
    const cat = categories.find((c) => c.id === categoryId);
    return cat ? cat.name : <span className="text-muted-foreground">-</span>;
  };

  const openCreateDialog = () => {
    setEditingProduct(null);
    setFormName('');
    setFormSku('');
    setFormDescription('');
    setFormCategoryId('');
    setFormUnit('piece');
    setFormMinStock('0');
    setFormMaxStock('');
    setFormOpen(true);
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormSku(product.sku);
    setFormDescription(product.description ?? '');
    setFormCategoryId(product.category_id ?? '');
    setFormUnit(product.unit_of_measure);
    setFormMinStock(String(product.min_stock));
    setFormMaxStock(product.max_stock != null ? String(product.max_stock) : '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const body = {
        name: formName,
        sku: formSku,
        description: formDescription || undefined,
        category_id: formCategoryId || undefined,
        unit_of_measure: formUnit,
        min_stock: Number(formMinStock),
        max_stock: formMaxStock ? Number(formMaxStock) : undefined,
      };
      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, body);
      } else {
        await api.post('/products', body);
      }
      setFormOpen(false);
      fetchProducts(editingProduct ? page : 1, search, filterCategoryId);
      if (!editingProduct) setPage(1);
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
      await api.del(`/products/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchProducts(page, search, filterCategoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleCategoryFilterChange = (value: string) => {
    setFilterCategoryId(value);
    setPage(1);
  };

  const columns: ColumnDef<Product>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (p) => <span className="font-mono text-sm">{p.sku}</span>,
    },
    {
      key: 'category',
      header: 'Categoria',
      render: (p) => getCategoryName(p.category_id),
    },
    {
      key: 'unit',
      header: 'Unidad de medida',
      render: (p) => UNIT_LABELS[p.unit_of_measure] ?? p.unit_of_measure,
    },
    {
      key: 'min_stock',
      header: 'Stock min',
      render: (p) => p.min_stock,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (p) => (
        <Badge variant={p.is_active ? 'default' : 'secondary'}>
          {p.is_active ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(p)}
            data-testid="edit-product-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(p)}
            data-testid="delete-product-btn"
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
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los productos de tu inventario
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-product-btn">
          Nuevo producto
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-sm"
          data-testid="search-input"
        />
        <Select
          value={filterCategoryId}
          onChange={(e) => handleCategoryFilterChange(e.target.value)}
          className="max-w-xs"
          data-testid="category-filter"
        >
          <option value="">Todas las categorias</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={products}
        total={total}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay productos registrados"
      />

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? 'Editar producto' : 'Nuevo producto'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-name">Nombre</Label>
                <Input
                  id="product-name"
                  name="name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Nombre del producto"
                  required
                  data-testid="product-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-sku">SKU</Label>
                <Input
                  id="product-sku"
                  name="sku"
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  placeholder="Codigo SKU"
                  required
                  data-testid="product-sku-input"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-description">Descripcion</Label>
              <Textarea
                id="product-description"
                name="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descripcion del producto (opcional)"
                rows={3}
                data-testid="product-description-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-category">Categoria</Label>
                <Select
                  id="product-category"
                  name="category_id"
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(e.target.value)}
                  data-testid="product-category-select"
                >
                  <option value="">Sin categoria</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-unit">Unidad de medida</Label>
                <Select
                  id="product-unit"
                  name="unit_of_measure"
                  value={formUnit}
                  onChange={(e) => setFormUnit(e.target.value as UnitType)}
                  required
                  data-testid="product-unit-select"
                >
                  {(Object.entries(UNIT_LABELS) as [UnitType, string][]).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-min-stock">Stock minimo</Label>
                <Input
                  id="product-min-stock"
                  name="min_stock"
                  type="number"
                  min="0"
                  value={formMinStock}
                  onChange={(e) => setFormMinStock(e.target.value)}
                  required
                  data-testid="product-min-stock-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-max-stock">Stock maximo</Label>
                <Input
                  id="product-max-stock"
                  name="max_stock"
                  type="number"
                  min="0"
                  value={formMaxStock}
                  onChange={(e) => setFormMaxStock(e.target.value)}
                  placeholder="Opcional"
                  data-testid="product-max-stock-input"
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
                {isSaving ? 'Guardando...' : editingProduct ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar producto"
        description={`Se eliminara el producto "${deleteTarget?.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
