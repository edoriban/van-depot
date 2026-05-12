'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  api,
  getProductClassLock,
  reclassifyProduct,
} from '@/lib/api-mutations';
import type {
  Product,
  Category,
  ClassLockStatus,
  PaginatedResponse,
  ProductClass,
  UnitType,
  MovementType,
} from '@/types';
import {
  PRODUCT_CLASS_VALUES,
  PRODUCT_CLASS_LABELS,
  PRODUCT_CLASS_BADGE_CLASSES,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Movement types for history ─────────────────────────────────────────

interface MovementRecord {
  id: string;
  product_id: string;
  from_location_id?: string | null;
  to_location_id?: string | null;
  quantity: number;
  movement_type: MovementType;
  user_id: string;
  reference?: string | null;
  notes?: string | null;
  supplier_id?: string | null;
  movement_reason?: string | null;
  created_at: string;
}

const movementTypeConfig: Record<MovementType, { label: string; className: string }> = {
  entry: { label: 'Entrada', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  exit: { label: 'Salida', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  transfer: { label: 'Transferencia', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  adjustment: { label: 'Ajuste', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [classLock, setClassLock] = useState<ClassLockStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reclassify dialog
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [reclassifyChoice, setReclassifyChoice] =
    useState<ProductClass>('raw_material');
  const [isReclassifying, setIsReclassifying] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formUnit, setFormUnit] = useState<UnitType>('piece');
  const [formHasExpiry, setFormHasExpiry] = useState(false);
  const [formMinStock, setFormMinStock] = useState('0');
  const [formMaxStock, setFormMaxStock] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  const populateForm = useCallback((p: Product) => {
    setFormName(p.name);
    setFormSku(p.sku);
    setFormDescription(p.description ?? '');
    setFormCategoryId(p.category_id ?? '');
    setFormUnit(p.unit_of_measure);
    setFormHasExpiry(p.has_expiry);
    setFormMinStock(String(p.min_stock));
    setFormMaxStock(p.max_stock != null ? String(p.max_stock) : '');
    setFormIsActive(p.is_active);
  }, []);

  const refetchClassLock = useCallback(async () => {
    try {
      const lock = await getProductClassLock(params.id);
      setClassLock(lock);
    } catch {
      // Lock probe is non-blocking — fall back to enabled UI; the API
      // would still 409 on the actual reclassify if locked.
      setClassLock(null);
    }
  }, [params.id]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [prod, catRes, lock] = await Promise.all([
          api.get<Product>(`/products/${params.id}`),
          api.get<PaginatedResponse<Category>>('/categories?page=1&per_page=100'),
          getProductClassLock(params.id).catch(() => null),
        ]);
        setProduct(prod);
        populateForm(prod);
        setCategories(catRes.data);
        setClassLock(lock);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar el producto');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [params.id, populateForm]);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // tool_spare can never carry has_expiry=true. Keep the constraint
      // mirrored on the wire even though the toggle is hidden in the UI.
      const hasExpiryForPayload =
        product?.product_class === 'tool_spare' ? false : formHasExpiry;
      const body = {
        name: formName,
        sku: formSku,
        description: formDescription || undefined,
        category_id: formCategoryId || undefined,
        unit_of_measure: formUnit,
        has_expiry: hasExpiryForPayload,
        min_stock: Number(formMinStock),
        max_stock: formMaxStock ? Number(formMaxStock) : undefined,
      };
      const updated = await api.put<Product>(`/products/${params.id}`, body);
      setProduct(updated);
      populateForm(updated);
      toast.success('Producto actualizado correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  const openReclassifyDialog = () => {
    if (!product) return;
    // Default the picker to the current class (no-op submit becomes a
    // valid happy-path scenario).
    setReclassifyChoice(product.product_class);
    setReclassifyOpen(true);
    // Refresh the lock status when opening the dialog so the user sees
    // the freshest counts (in case a movement just landed).
    void refetchClassLock();
  };

  const handleReclassifyConfirm = async () => {
    if (!product) return;
    setIsReclassifying(true);
    try {
      const updated = await reclassifyProduct(product.id, reclassifyChoice);
      setProduct(updated);
      populateForm(updated);
      setReclassifyOpen(false);
      toast.success(
        `Producto reclasificado a ${PRODUCT_CLASS_LABELS[updated.product_class]}`,
      );
      void refetchClassLock();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al reclasificar producto',
      );
    } finally {
      setIsReclassifying(false);
    }
  };

  /**
   * Build a Spanish lock-reason sentence mentioning only non-zero counts,
   * e.g. "Bloqueado por: 2 movimientos, 1 lote".
   */
  const lockReason = (lock: ClassLockStatus): string => {
    const parts: string[] = [];
    if (lock.movements > 0) {
      parts.push(
        `${lock.movements} ${lock.movements === 1 ? 'movimiento' : 'movimientos'}`,
      );
    }
    if (lock.lots > 0) {
      parts.push(`${lock.lots} ${lock.lots === 1 ? 'lote' : 'lotes'}`);
    }
    if (lock.tool_instances > 0) {
      parts.push(
        `${lock.tool_instances} ${lock.tool_instances === 1 ? 'herramienta' : 'herramientas'}`,
      );
    }
    return parts.length > 0
      ? `Bloqueado por: ${parts.join(', ')}`
      : 'Bloqueado';
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => push('/productos')}>
          Volver a productos
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? 'Producto no encontrado'}
        </div>
      </div>
    );
  }

  const isLocked = classLock?.locked ?? false;
  const reclassifyDisabled = isReclassifying || isLocked;
  const tooltipText = classLock && isLocked ? lockReason(classLock) : '';

  return (
    <div className="space-y-6" data-testid="product-detail-page">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => push('/productos')}
          >
            Volver a productos
          </Button>
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <Badge
            variant="outline"
            className={cn(
              'border-0',
              PRODUCT_CLASS_BADGE_CLASSES[product.product_class],
            )}
            data-testid="product-class-badge"
            data-class={product.product_class}
          >
            {PRODUCT_CLASS_LABELS[product.product_class]}
          </Badge>
          {product.has_expiry && (
            <Badge
              variant="outline"
              className="border-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
              data-testid="product-has-expiry-chip"
            >
              Con caducidad
            </Badge>
          )}
          <Badge variant={product.is_active ? 'default' : 'secondary'}>
            {product.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
          {isLocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span wrapper keeps the tooltip working on a disabled
                    button (disabled buttons don't fire mouse events). */}
                <span
                  tabIndex={0}
                  data-testid="reclassify-btn-wrapper"
                  className="inline-block"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    aria-disabled="true"
                    data-testid="reclassify-btn"
                    data-locked="true"
                  >
                    Reclasificar
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-xs text-xs"
                data-testid="reclassify-lock-tooltip"
              >
                {tooltipText}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={openReclassifyDialog}
              data-testid="reclassify-btn"
              data-locked="false"
            >
              Reclasificar
            </Button>
          )}
        </div>
      </div>

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion del producto</CardTitle>
          <CardDescription>
            Edita los campos y guarda los cambios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="detail-name">Nombre</Label>
                <Input
                  id="detail-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Nombre del producto"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-sku">SKU</Label>
                <Input
                  id="detail-sku"
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  placeholder="Codigo SKU"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="detail-description">Descripcion</Label>
              <Textarea
                id="detail-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descripcion del producto (opcional)"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="detail-category">Categoria</Label>
                <SearchableSelect
                  value={formCategoryId || 'none'}
                  onValueChange={(val) =>
                    setFormCategoryId(val === 'none' ? '' : val)
                  }
                  options={[
                    { value: 'none', label: 'Sin categoria' },
                    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                  ]}
                  placeholder="Sin categoria"
                  searchPlaceholder="Buscar categoria..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-unit">Unidad de medida</Label>
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
                <Label htmlFor="detail-min-stock">Stock minimo</Label>
                <Input
                  id="detail-min-stock"
                  type="number"
                  min="0"
                  value={formMinStock}
                  onChange={(e) => setFormMinStock(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-max-stock">Stock maximo</Label>
                <Input
                  id="detail-max-stock"
                  type="number"
                  min="0"
                  value={formMaxStock}
                  onChange={(e) => setFormMaxStock(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>

            {/* has_expiry: hidden when class = tool_spare (invariant). */}
            {product.product_class !== 'tool_spare' ? (
              <div className="space-y-2">
                <Label htmlFor="detail-has-expiry">Caducidad</Label>
                <div className="flex h-9 items-center gap-2">
                  <input
                    id="detail-has-expiry"
                    type="checkbox"
                    checked={formHasExpiry}
                    onChange={(e) => setFormHasExpiry(e.target.checked)}
                    className="size-4 rounded border-input accent-primary"
                    data-testid="detail-has-expiry-toggle"
                  />
                  <label
                    htmlFor="detail-has-expiry"
                    className="text-sm text-muted-foreground"
                  >
                    Este producto tiene fecha de caducidad
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2" data-testid="detail-has-expiry-hidden">
                <Label>Caducidad</Label>
                <div className="flex h-9 items-center text-sm text-muted-foreground">
                  Las herramientas / refacciones no manejan caducidad.
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="detail-status">Estado</Label>
              <Select
                value={formIsActive ? 'active' : 'inactive'}
                onValueChange={(val) => setFormIsActive(val === 'active')}
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="inactive">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Audit info */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion de auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Creado el:</span>{' '}
              <span className="font-medium">{formatDate(product.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Actualizado el:</span>{' '}
              <span className="font-medium">{formatDate(product.updated_at)}</span>
            </div>
            {product.created_by_email && (
              <div>
                <span className="text-muted-foreground">Creado por:</span>{' '}
                <span className="font-medium">{product.created_by_email}</span>
              </div>
            )}
            {product.updated_by_email && (
              <div>
                <span className="text-muted-foreground">Ultima modificacion por:</span>{' '}
                <span className="font-medium">{product.updated_by_email}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Movement history */}
      <MovementHistory productId={params.id} />

      {/* Reclassify dialog */}
      <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
        <DialogContent data-testid="reclassify-dialog">
          <DialogHeader>
            <DialogTitle>Reclasificar producto</DialogTitle>
          </DialogHeader>
          {classLock?.locked ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Este producto ya tiene historial y no se puede reclasificar:
              </p>
              <p
                className="font-medium text-destructive"
                data-testid="reclassify-lock-reason"
              >
                {lockReason(classLock)}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecciona la nueva clase. Esta acción solo está disponible
                mientras el producto no tenga movimientos, lotes ni
                herramientas asociadas.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reclassify-class">Nueva clase</Label>
                <SearchableSelect
                  value={reclassifyChoice}
                  onValueChange={(val) =>
                    setReclassifyChoice(val as ProductClass)
                  }
                  options={PRODUCT_CLASS_VALUES.map((value) => ({
                    value,
                    label: PRODUCT_CLASS_LABELS[value],
                  }))}
                  placeholder="Seleccionar clase"
                  searchPlaceholder="Buscar clase..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReclassifyOpen(false)}
              disabled={isReclassifying}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleReclassifyConfirm}
              disabled={reclassifyDisabled}
              data-testid="reclassify-confirm-btn"
              data-locked={isLocked ? 'true' : 'false'}
            >
              {isReclassifying ? 'Reclasificando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Movement History Component ─────────────────────────────────────────

function MovementHistory({ productId }: { productId: string }) {
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString();
  }, []);

  const fetchMovements = useCallback(
    async (pageNum: number, append: boolean) => {
      setIsLoading(true);
      try {
        const res = await api.get<PaginatedResponse<MovementRecord>>(
          `/movements?product_id=${productId}&per_page=${perPage}&page=${pageNum}&start_date=${encodeURIComponent(sixMonthsAgo)}`
        );
        setMovements((prev) => (append ? [...prev, ...res.data] : res.data));
        setTotal(res.total);
      } catch {
        // silently fail — section is non-critical
      } finally {
        setIsLoading(false);
      }
    },
    [productId, sixMonthsAgo]
  );

  useEffect(() => {
    fetchMovements(1, false);
  }, [fetchMovements]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchMovements(next, true);
  };

  const hasMore = movements.length < total;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de movimientos</CardTitle>
        <CardDescription>
          Movimientos de los ultimos 6 meses
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && movements.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12 ml-auto" />
              </div>
            ))}
          </div>
        ) : movements.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            No hay movimientos registrados en los ultimos 6 meses
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origen / Destino</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((mov) => {
                  const config = movementTypeConfig[mov.movement_type];
                  return (
                    <TableRow key={mov.id}>
                      <TableCell>
                        <Badge variant="outline" className={cn('border-0', config.className)}>
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-xs">
                          {mov.from_location_id ?? '—'} → {mov.to_location_id ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">{mov.quantity}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {mov.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatDate(mov.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                >
                  {isLoading ? 'Cargando...' : 'Cargar mas'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
