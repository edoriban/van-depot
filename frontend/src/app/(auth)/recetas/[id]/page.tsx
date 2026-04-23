'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  RecipeDetail,
  RecipeItem,
  RecipeItemInput,
  Product,
  PaginatedResponse,
} from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  TaskDaily01Icon,
  PencilEdit01Icon,
  Delete01Icon,
  Add01Icon,
} from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { toast } from 'sonner';
import { DispatchWizard } from '@/components/recipes/dispatch-wizard';

// --- Main Page ---

export default function RecipeDetailPage() {
  const params = useParams();
  const recipeId = params.id as string;

  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local items state (for editing before save)
  const [localItems, setLocalItems] = useState<RecipeItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Edit recipe dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Add item dialog
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [itemQuantity, setItemQuantity] = useState('');
  const [itemNotes, setItemNotes] = useState('');

  // Remove item
  const [removeTarget, setRemoveTarget] = useState<RecipeItem | null>(null);

  // Dispatch wizard
  const [dispatchWizardOpen, setDispatchWizardOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<RecipeDetail>(`/recipes/${recipeId}`);
      setDetail(res);
      setLocalItems(res.items);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar receta');
    } finally {
      setIsLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    if (recipeId) fetchDetail();
  }, [recipeId, fetchDetail]);

  // Fetch products for add-item dialog
  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Product>>(
        '/products?per_page=100&page=1'
      );
      setProducts(res.data);
    } catch {
      toast.error('Error al cargar productos');
    } finally {
      setProductsLoading(false);
    }
  };


  // --- Edit recipe name/description ---

  const openEditDialog = () => {
    if (!detail) return;
    setEditName(detail.recipe.name);
    setEditDescription(detail.recipe.description ?? '');
    setEditOpen(true);
  };

  const handleEditSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.put(`/recipes/${recipeId}`, {
        name: editName,
        description: editDescription || undefined,
      });
      setEditOpen(false);
      await fetchDetail();
      toast.success('Receta actualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Add item ---

  const openAddItemDialog = () => {
    setSelectedProductId('');
    setItemQuantity('');
    setItemNotes('');
    setProductSearch('');
    setAddItemOpen(true);
    fetchProducts();
  };

  const handleAddItem = () => {
    if (!selectedProductId || !itemQuantity) return;
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;

    // Check if product already in list
    const exists = localItems.some((item) => item.product_id === selectedProductId);
    if (exists) {
      toast.error('Este producto ya esta en la receta');
      return;
    }

    const newItem: RecipeItem = {
      id: `temp-${Date.now()}`,
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      unit_of_measure: product.unit_of_measure,
      quantity: Number(itemQuantity),
      notes: itemNotes || null,
    };

    setLocalItems((prev) => [...prev, newItem]);
    setHasChanges(true);
    setAddItemOpen(false);
    toast.success('Material agregado');
  };

  // --- Remove item ---

  const handleRemoveItem = () => {
    if (!removeTarget) return;
    setLocalItems((prev) => prev.filter((item) => item.id !== removeTarget.id));
    setHasChanges(true);
    setRemoveTarget(null);
  };

  // --- Save items ---

  const handleSaveItems = async () => {
    setIsSaving(true);
    try {
      const items: RecipeItemInput[] = localItems.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        notes: item.notes ?? undefined,
      }));
      await api.put(`/recipes/${recipeId}`, {
        name: detail?.recipe.name,
        description: detail?.recipe.description,
        items,
      });
      await fetchDetail();
      toast.success('Materiales guardados correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar materiales');
    } finally {
      setIsSaving(false);
    }
  };


  // Filtered products for search
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  // --- Item table columns ---

  const itemColumns: ColumnDef<RecipeItem>[] = [
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
      key: 'quantity',
      header: 'Cantidad',
      render: (item) => <span className="font-medium">{item.quantity}</span>,
    },
    {
      key: 'unit',
      header: 'Unidad',
      render: (item) => item.unit_of_measure,
    },
    {
      key: 'notes',
      header: 'Notas',
      render: (item) =>
        item.notes || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (item) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setRemoveTarget(item)}
          data-testid="remove-item-btn"
        >
          <HugeiconsIcon icon={Delete01Icon} size={16} />
        </Button>
      ),
    },
  ];

  // --- Render ---

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="recipe-detail-loading">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-6" data-testid="recipe-detail-error">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/recetas">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Receta no encontrada</h1>
        </div>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error || 'No se pudo cargar la receta solicitada.'}
        </div>
      </div>
    );
  }

  const { recipe } = detail;

  return (
    <div className="space-y-6" data-testid="recipe-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/recetas" data-testid="back-to-recipes">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{recipe.name}</h1>
            <p className="text-muted-foreground">
              {recipe.description || 'Sin descripcion'}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={openEditDialog} data-testid="edit-recipe-btn">
          <HugeiconsIcon icon={PencilEdit01Icon} size={16} className="mr-2" />
          Editar
        </Button>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={openAddItemDialog} data-testid="add-item-btn">
          <HugeiconsIcon icon={Add01Icon} size={16} className="mr-2" />
          Agregar Material
        </Button>
        {hasChanges && (
          <Button
            variant="default"
            onClick={handleSaveItems}
            disabled={isSaving}
            data-testid="save-items-btn"
          >
            {isSaving ? 'Guardando...' : 'Guardar Cambios'}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setDispatchWizardOpen(true)}
          disabled={localItems.length === 0}
          data-testid="dispatch-wizard-btn"
        >
          <HugeiconsIcon icon={TaskDaily01Icon} size={16} className="mr-2" />
          Despachar receta
        </Button>
      </div>

      {/* Items table */}
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          {localItems.length} material{localItems.length !== 1 ? 'es' : ''} en esta receta
          {hasChanges && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              (cambios sin guardar)
            </span>
          )}
        </p>

        <DataTable
          columns={itemColumns}
          data={localItems}
          total={localItems.length}
          page={1}
          perPage={100}
          onPageChange={() => {}}
          isLoading={false}
          emptyMessage="No hay materiales en esta receta"
          emptyState={
            <EmptyState
              icon={TaskDaily01Icon}
              title="Sin materiales"
              description="Agrega productos a esta receta para definir los materiales necesarios."
              actionLabel="Agregar Material"
              onAction={openAddItemDialog}
            />
          }
        />
      </div>

      {/* Edit Recipe Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Receta</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-recipe-name">Nombre</Label>
              <Input
                id="edit-recipe-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nombre de la receta"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-recipe-desc">Descripcion (opcional)</Label>
              <Textarea
                id="edit-recipe-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Descripcion del proyecto"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="edit-submit-btn">
                {isSaving ? 'Guardando...' : 'Actualizar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar Material</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Buscar producto</Label>
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar por nombre o SKU..."
              />
            </div>
            <div className="space-y-2">
              <Label>Producto</Label>
              {productsLoading ? (
                <div className="h-10 bg-muted rounded animate-pulse" />
              ) : (
                <Select
                  value={selectedProductId}
                  onValueChange={setSelectedProductId}
                >
                  <SelectTrigger className="w-full" data-testid="product-select">
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-quantity">Cantidad</Label>
              <Input
                id="item-quantity"
                type="number"
                min="0.01"
                step="any"
                value={itemQuantity}
                onChange={(e) => setItemQuantity(e.target.value)}
                placeholder="Cantidad requerida"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-notes">Notas (opcional)</Label>
              <Input
                id="item-notes"
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                placeholder="Notas adicionales"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddItemOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleAddItem}
                disabled={!selectedProductId || !itemQuantity}
                data-testid="confirm-add-item-btn"
              >
                Agregar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Item Confirmation */}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Quitar material"
        description={`Se quitara "${removeTarget?.product_name}" de la receta.`}
        onConfirm={handleRemoveItem}
        confirmLabel="Quitar"
      />

      {/* Dispatch Wizard */}
      <DispatchWizard
        recipeId={recipeId}
        recipeName={recipe.name}
        open={dispatchWizardOpen}
        onOpenChange={setDispatchWizardOpen}
        onDispatchComplete={fetchDetail}
      />
    </div>
  );
}
