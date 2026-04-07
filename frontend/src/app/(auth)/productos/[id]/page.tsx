'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type { Product, Category, PaginatedResponse, UnitType, MovementType } from '@/types';
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
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formUnit, setFormUnit] = useState<UnitType>('piece');
  const [formMinStock, setFormMinStock] = useState('0');
  const [formMaxStock, setFormMaxStock] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  const populateForm = useCallback((p: Product) => {
    setFormName(p.name);
    setFormSku(p.sku);
    setFormDescription(p.description ?? '');
    setFormCategoryId(p.category_id ?? '');
    setFormUnit(p.unit_of_measure);
    setFormMinStock(String(p.min_stock));
    setFormMaxStock(p.max_stock != null ? String(p.max_stock) : '');
    setFormIsActive(p.is_active);
  }, []);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [prod, catRes] = await Promise.all([
          api.get<Product>(`/products/${params.id}`),
          api.get<PaginatedResponse<Category>>('/categories?page=1&per_page=100'),
        ]);
        setProduct(prod);
        populateForm(prod);
        setCategories(catRes.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar el producto');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [params.id, populateForm]);

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
      const updated = await api.put<Product>(`/products/${params.id}`, body);
      setProduct(updated);
      toast.success('Producto actualizado correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
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
        <Button variant="outline" onClick={() => router.push('/productos')}>
          Volver a productos
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? 'Producto no encontrado'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="product-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/productos')}
          >
            Volver a productos
          </Button>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <Badge variant={product.is_active ? 'default' : 'secondary'}>
            {product.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
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
