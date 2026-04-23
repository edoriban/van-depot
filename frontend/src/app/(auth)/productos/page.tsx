'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { api, isApiError } from '@/lib/api-mutations';
import { toast } from 'sonner';
import type {
  Product,
  Category,
  PaginatedResponse,
  UnitType,
  ProductClass,
} from '@/types';
import {
  PRODUCT_CLASS_VALUES,
  PRODUCT_CLASS_LABELS,
  PRODUCT_CLASS_LABELS_SHORT,
  PRODUCT_CLASS_BADGE_CLASSES,
} from '@/types';
import { cn } from '@/lib/utils';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Package01Icon, Tag01Icon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { SearchableSelect } from '@/components/ui/searchable-select';
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

// Chip row filter. Value `null` means "Todos" (no filter). URL-bound via
// `?class=`; invalid or missing values behave as "Todos".
const CLASS_CHIPS: ReadonlyArray<{ value: ProductClass | null; label: string; testId: string }> = [
  { value: null, label: 'Todos', testId: 'class-chip-all' },
  { value: 'raw_material', label: 'Materia prima', testId: 'class-chip-raw-material' },
  { value: 'consumable', label: 'Consumibles', testId: 'class-chip-consumable' },
  { value: 'tool_spare', label: 'Herramientas', testId: 'class-chip-tool-spare' },
] as const;

function isProductClass(value: unknown): value is ProductClass {
  return (
    value === 'raw_material' || value === 'consumable' || value === 'tool_spare'
  );
}

// ==========================================
// Products Tab
// ==========================================

function ProductsTab({
  categories,
  fetchCategories: _fetchCategories,
  filterClass,
  setFilterClass,
  filterManufactured,
  setFilterManufactured,
}: {
  categories: Category[];
  fetchCategories: () => void;
  filterClass: ProductClass | null;
  setFilterClass: (value: ProductClass | null) => void;
  filterManufactured: boolean;
  setFilterManufactured: (value: boolean) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
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
  const [formClass, setFormClass] = useState<ProductClass>('raw_material');
  const [formHasExpiry, setFormHasExpiry] = useState(false);
  // Only meaningful when `formClass === 'raw_material'`. Auto-cleared via
  // `handleFormClassChange` when the user moves to a non-raw_material class.
  const [formIsManufactured, setFormIsManufactured] = useState(false);
  // One-shot warning shown when the user switches away from `raw_material`
  // while `is_manufactured` was true — they lose the flag silently otherwise.
  const [manufacturedResetWarning, setManufacturedResetWarning] =
    useState(false);
  const [formMinStock, setFormMinStock] = useState('0');
  const [formMaxStock, setFormMaxStock] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchProducts = useCallback(
    async (
      p: number,
      s: string,
      catId: string,
      cls: ProductClass | null,
      onlyManufactured: boolean,
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        let url = `/products?page=${p}&per_page=${perPage}`;
        if (s) url += `&search=${encodeURIComponent(s)}`;
        if (catId) url += `&category_id=${catId}`;
        if (cls) url += `&class=${cls}`;
        if (onlyManufactured) url += `&is_manufactured=true`;
        const res = await api.get<PaginatedResponse<Product>>(url);
        setProducts(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar productos');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchProducts(page, search, filterCategoryId, filterClass, filterManufactured);
  }, [page, search, filterCategoryId, filterClass, filterManufactured, fetchProducts]);

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
    setFormClass('raw_material');
    setFormHasExpiry(false);
    setFormIsManufactured(false);
    setManufacturedResetWarning(false);
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
    setFormClass(product.product_class);
    setFormHasExpiry(product.has_expiry);
    setFormIsManufactured(product.is_manufactured);
    setManufacturedResetWarning(false);
    setFormMinStock(String(product.min_stock));
    setFormMaxStock(product.max_stock != null ? String(product.max_stock) : '');
    setFormOpen(true);
  };

  // Enforce the class/expiry invariant at the form boundary: tool_spare never
  // allows has_expiry=true. Also enforce the class/is_manufactured invariant
  // — leaving `raw_material` auto-clears the Manufacturable flag, with an
  // inline warning so the user is not surprised.
  const handleFormClassChange = (next: ProductClass) => {
    setFormClass(next);
    if (next === 'tool_spare') {
      setFormHasExpiry(false);
    }
    if (next !== 'raw_material' && formIsManufactured) {
      setFormIsManufactured(false);
      setManufacturedResetWarning(true);
    } else {
      setManufacturedResetWarning(false);
    }
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // Normalize: tool_spare never sends has_expiry=true, regardless of what
      // an out-of-date toggle state might say.
      const hasExpiryForPayload =
        formClass === 'tool_spare' ? false : formHasExpiry;
      // Normalize is_manufactured: only raw_material can be manufactured.
      // This mirrors the backend cross-field invariant so the user can't
      // submit an invalid combo by racing the class change.
      const isManufacturedForPayload =
        formClass === 'raw_material' ? formIsManufactured : false;
      const basePayload = {
        name: formName,
        sku: formSku,
        description: formDescription || undefined,
        category_id: formCategoryId || undefined,
        unit_of_measure: formUnit,
        has_expiry: hasExpiryForPayload,
        is_manufactured: isManufacturedForPayload,
        min_stock: Number(formMinStock),
        max_stock: formMaxStock ? Number(formMaxStock) : undefined,
      };
      if (editingProduct) {
        // product_class cannot be updated through PUT — that's what PATCH
        // /products/{id}/class is for (detail page).
        await api.put(`/products/${editingProduct.id}`, basePayload);
      } else {
        await api.post('/products', {
          ...basePayload,
          product_class: formClass,
        });
      }
      setFormOpen(false);
      fetchProducts(
        editingProduct ? page : 1,
        search,
        filterCategoryId,
        filterClass,
        filterManufactured,
      );
      if (!editingProduct) setPage(1);
    } catch (err) {
      // Surface the typed 422 cross-field invariant as a Spanish toast so the
      // user understands WHY the save failed (the class/is_manufactured combo
      // is illegal). Other errors fall through to the banner so the form
      // stays open for retry.
      if (
        isApiError(err) &&
        err.code === 'PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL'
      ) {
        toast.error(
          "No se puede marcar este producto como manufacturable porque su clase no es 'Materia prima'.",
        );
      } else {
        setError(err instanceof Error ? err.message : 'Error al guardar');
      }
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
      fetchProducts(page, search, filterCategoryId, filterClass, filterManufactured);
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
      render: (p) => (
        <Link
          href={`/productos/${p.id}`}
          className="font-bold text-foreground hover:underline"
          data-testid="product-detail-link"
        >
          {p.name}
        </Link>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (p) => <span className="font-mono text-sm">{p.sku}</span>,
    },
    {
      key: 'class',
      header: 'Clase',
      render: (p) => (
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn('border-0', PRODUCT_CLASS_BADGE_CLASSES[p.product_class])}
            data-testid="product-class-badge"
            data-class={p.product_class}
          >
            {PRODUCT_CLASS_LABELS_SHORT[p.product_class]}
          </Badge>
          {p.is_manufactured && (
            <Badge
              variant="outline"
              className="border-0 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
              data-testid="product-manufactured-badge"
              title="Este producto es el objetivo de una orden de trabajo"
            >
              MFG
            </Badge>
          )}
        </div>
      ),
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

  const handleChipClick = (next: ProductClass | null) => {
    setFilterClass(next);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Class chip-row (URL-bound via ?class=). Keep visually stable even
          when filters below are interacted with. The Manufacturables chip
          is separate from the class filter: it sets ?is_manufactured=true
          without constraining product_class. Even though the backend
          invariant restricts manufacturables to raw_material, we still let
          the two filters compose orthogonally so stale data doesn't hide. */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Filtrar por clase de producto"
        data-testid="class-chip-row"
      >
        {CLASS_CHIPS.map((chip) => {
          const isActive = filterClass === chip.value;
          return (
            <button
              key={chip.testId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-pressed={isActive}
              onClick={() => handleChipClick(chip.value)}
              data-testid={chip.testId}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {chip.label}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={filterManufactured}
          aria-pressed={filterManufactured}
          onClick={() => {
            setFilterManufactured(!filterManufactured);
            setPage(1);
          }}
          data-testid="class-chip-manufactured"
          data-active={filterManufactured ? 'true' : 'false'}
          className={cn(
            'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors',
            filterManufactured
              ? 'border-orange-500 bg-orange-500 text-white'
              : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          Manufacturables
        </button>
      </div>

      <div className="flex items-center justify-between">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="max-w-sm"
            data-testid="search-input"
          />
          <SearchableSelect
            value={filterCategoryId || 'all'}
            onValueChange={(val) => handleCategoryFilterChange(val === 'all' ? '' : val)}
            options={[
              { value: 'all', label: 'Todas las categorias' },
              ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
            ]}
            placeholder="Todas las categorias"
            searchPlaceholder="Buscar categoria..."
            className="max-w-xs"
          />
        </div>
        <Button onClick={openCreateDialog} data-testid="new-product-btn">
          Nuevo producto
        </Button>
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
        emptyState={
          <EmptyState
            icon={Package01Icon}
            title="Aun no tienes productos registrados"
            description="Agrega tu primer producto para empezar a controlar tu stock."
            actionLabel="Nuevo producto"
            onAction={openCreateDialog}
          />
        }
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
                <SearchableSelect
                  value={formCategoryId || 'none'}
                  onValueChange={(val) => setFormCategoryId(val === 'none' ? '' : val)}
                  options={[
                    { value: 'none', label: 'Sin categoria' },
                    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                  ]}
                  placeholder="Sin categoria"
                  searchPlaceholder="Buscar categoria..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-unit">Unidad de medida</Label>
                <SearchableSelect
                  value={formUnit}
                  onValueChange={(val) => setFormUnit(val as UnitType)}
                  options={(Object.entries(UNIT_LABELS) as [UnitType, string][]).map(
                    ([value, label]) => ({ value, label })
                  )}
                  placeholder="Seleccionar unidad"
                  searchPlaceholder="Buscar unidad..."
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-class">Clase</Label>
                {editingProduct ? (
                  <div
                    className="flex h-9 items-center gap-2 rounded-3xl border border-dashed px-3 text-sm text-muted-foreground"
                    data-testid="product-class-readonly"
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        'border-0',
                        PRODUCT_CLASS_BADGE_CLASSES[formClass],
                      )}
                    >
                      {PRODUCT_CLASS_LABELS[formClass]}
                    </Badge>
                    <span className="text-xs">
                      Usa &ldquo;Reclasificar&rdquo; en el detalle para cambiar la clase.
                    </span>
                  </div>
                ) : (
                  <div data-testid="product-class-select-wrapper">
                    <SearchableSelect
                      value={formClass}
                      onValueChange={(val) =>
                        handleFormClassChange(val as ProductClass)
                      }
                      options={PRODUCT_CLASS_VALUES.map((value) => ({
                        value,
                        label: PRODUCT_CLASS_LABELS[value],
                      }))}
                      placeholder="Seleccionar clase"
                      searchPlaceholder="Buscar clase..."
                    />
                  </div>
                )}
              </div>
              {/* has_expiry: hidden when class = tool_spare (invariant:
                  tool_spare never has expiry). Rendered as a plain checkbox
                  for simplicity — the design system has no Switch component
                  and shadcn Checkbox is not installed here. */}
              {formClass !== 'tool_spare' ? (
                <div className="space-y-2">
                  <Label htmlFor="product-has-expiry">Caducidad</Label>
                  <div className="flex h-9 items-center gap-2">
                    <input
                      id="product-has-expiry"
                      type="checkbox"
                      checked={formHasExpiry}
                      onChange={(e) => setFormHasExpiry(e.target.checked)}
                      className="size-4 rounded border-input accent-primary"
                      data-testid="product-has-expiry-toggle"
                    />
                    <label
                      htmlFor="product-has-expiry"
                      className="text-sm text-muted-foreground"
                    >
                      Este producto tiene fecha de caducidad
                    </label>
                  </div>
                </div>
              ) : (
                <div
                  className="space-y-2"
                  data-testid="product-has-expiry-hidden"
                >
                  <Label>Caducidad</Label>
                  <div className="flex h-9 items-center text-sm text-muted-foreground">
                    Las herramientas / refacciones no manejan caducidad.
                  </div>
                </div>
              )}
            </div>
            {/* is_manufactured toggle — only meaningful for raw_material.
                When the class is non-raw_material we render a disabled
                placeholder so the user understands why the flag is
                unavailable (class-gated invariant). */}
            <div className="space-y-2">
              <Label htmlFor="product-is-manufactured">
                Manufacturable
              </Label>
              {formClass === 'raw_material' ? (
                <div className="flex flex-col gap-1">
                  <div className="flex h-9 items-center gap-2">
                    <input
                      id="product-is-manufactured"
                      type="checkbox"
                      checked={formIsManufactured}
                      onChange={(e) => setFormIsManufactured(e.target.checked)}
                      className="size-4 rounded border-input accent-primary"
                      data-testid="product-is-manufactured-toggle"
                    />
                    <label
                      htmlFor="product-is-manufactured"
                      className="text-sm text-muted-foreground"
                    >
                      Marcar si este producto se fabrica internamente (puede
                      ser el objetivo de una orden de trabajo).
                    </label>
                  </div>
                </div>
              ) : (
                <div
                  className="flex h-9 items-center text-sm text-muted-foreground"
                  data-testid="product-is-manufactured-disabled"
                >
                  Solo los productos de clase &ldquo;Materia prima&rdquo; pueden
                  marcarse como manufacturables.
                </div>
              )}
              {manufacturedResetWarning && (
                <p
                  className="text-xs text-amber-600 dark:text-amber-400"
                  data-testid="product-manufactured-reset-warning"
                >
                  El indicador &ldquo;Manufacturable&rdquo; se desactiva al
                  cambiar la clase.
                </p>
              )}
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

// ==========================================
// Categories Tab
// ==========================================

function CategoriesTab({
  categories: allCategories,
  fetchAllCategories,
}: {
  categories: Category[];
  fetchAllCategories: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
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

  // Filter out the current category from parent options
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
    <div className="space-y-4">
      <div className="flex items-center justify-end">
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
              <SearchableSelect
                value={formParentId || 'none'}
                onValueChange={(val) => setFormParentId(val === 'none' ? '' : val)}
                options={[
                  { value: 'none', label: 'Sin categoria padre' },
                  ...parentOptions.map((cat) => ({ value: cat.id, label: cat.name })),
                ]}
                placeholder="Sin categoria padre"
                searchPlaceholder="Buscar categoria..."
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

// ==========================================
// Main Page
// ==========================================

export default function ProductosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') || 'productos';

  // URL-bound class filter (`?class=`). Source of truth lives in the URL so
  // the chip selection persists across reloads and back-button navigation.
  const rawClass = searchParams.get('class');
  const filterClass: ProductClass | null = isProductClass(rawClass)
    ? rawClass
    : null;
  // URL-bound Manufacturables chip. Binary filter — presence of the param
  // with value 'true' means filter on, everything else means off.
  const filterManufactured = searchParams.get('is_manufactured') === 'true';

  const handleTabChange = (value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', value);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const setFilterClass = useCallback(
    (next: ProductClass | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === null) {
        sp.delete('class');
      } else {
        sp.set('class', next);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  const setFilterManufactured = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next) {
        sp.set('is_manufactured', 'true');
      } else {
        sp.delete('is_manufactured');
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  const [categories, setCategories] = useState<Category[]>([]);

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

  return (
    <div className="space-y-6" data-testid="productos-page">
      <div>
        <h1 className="text-2xl font-bold">Productos</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona los productos y categorias de tu inventario
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="productos" data-testid="tab-productos">
            Productos
          </TabsTrigger>
          <TabsTrigger value="categorias" data-testid="tab-categorias">
            Categorias
          </TabsTrigger>
        </TabsList>

        <TabsContent value="productos">
          <ProductsTab
            categories={categories}
            fetchCategories={fetchCategories}
            filterClass={filterClass}
            setFilterClass={setFilterClass}
            filterManufactured={filterManufactured}
            setFilterManufactured={setFilterManufactured}
          />
        </TabsContent>

        <TabsContent value="categorias">
          <CategoriesTab categories={categories} fetchAllCategories={fetchCategories} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
