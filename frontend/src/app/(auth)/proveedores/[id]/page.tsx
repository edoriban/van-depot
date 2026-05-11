'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  Supplier,
  SupplierProduct,
  Product,
  PurchaseOrder,
  PaginatedResponse,
} from '@/types';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { toast } from 'sonner';
import Link from 'next/link';
import { Package01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

// --- Status config ---

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  sent: { label: 'Enviada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  partially_received: { label: 'Parcial', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  completed: { label: 'Completada', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  cancelled: { label: 'Cancelada', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
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

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// --- KPI Card ---

function KpiCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main page ---

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // KPIs
  const [totalOrders, setTotalOrders] = useState(0);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [lastOrderDate, setLastOrderDate] = useState<string | null>(null);
  const [productsCount, setProductsCount] = useState(0);

  // Recent orders
  const [recentOrders, setRecentOrders] = useState<PurchaseOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  // Supplier products
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productSearch, setProductSearch] = useState('');

  // Link product dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [linkProductId, setLinkProductId] = useState('');
  const [linkSupplierSku, setLinkSupplierSku] = useState('');
  const [linkUnitCost, setLinkUnitCost] = useState('');
  const [linkLeadTime, setLinkLeadTime] = useState('');
  const [linkMinOrder, setLinkMinOrder] = useState('1');
  const [isLinking, setIsLinking] = useState(false);

  // Unlink product
  const [unlinkTarget, setUnlinkTarget] = useState<SupplierProduct | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const populateForm = useCallback((s: Supplier) => {
    setFormName(s.name);
    setFormContactName(s.contact_name ?? '');
    setFormPhone(s.phone ?? '');
    setFormEmail(s.email ?? '');
  }, []);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await api.get<SupplierProduct[]>(`/suppliers/${params.id}/products`);
      const prods = Array.isArray(res) ? res : [];
      setProducts(prods);
      setProductsCount(prods.length);
    } catch {
      toast.error('Error al cargar productos del proveedor');
    } finally {
      setProductsLoading(false);
    }
  }, [params.id]);

  const fetchAllProducts = useCallback(async () => {
    try {
      const res = await api.get<Product[] | PaginatedResponse<Product>>('/products');
      setAllProducts(Array.isArray(res) ? res : res.data);
    } catch {
      // silent
    }
  }, []);

  const handleLinkProduct = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLinking(true);
    try {
      await api.post(`/suppliers/${params.id}/products`, {
        product_id: linkProductId,
        supplier_sku: linkSupplierSku || undefined,
        unit_cost: Number(linkUnitCost),
        lead_time_days: Number(linkLeadTime),
        minimum_order_qty: Number(linkMinOrder),
      });
      toast.success('Producto vinculado correctamente');
      setLinkOpen(false);
      setLinkProductId('');
      setLinkSupplierSku('');
      setLinkUnitCost('');
      setLinkLeadTime('');
      setLinkMinOrder('1');
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al vincular producto');
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlinkProduct = async () => {
    if (!unlinkTarget) return;
    setIsUnlinking(true);
    try {
      await api.del(`/supplier-products/${unlinkTarget.id}`);
      toast.success('Producto desvinculado');
      setUnlinkTarget(null);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al desvincular');
    } finally {
      setIsUnlinking(false);
    }
  };

  const openLinkDialog = () => {
    fetchAllProducts();
    setLinkOpen(true);
  };

  // Load supplier
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const s = await api.get<Supplier>(`/suppliers/${params.id}`);
        setSupplier(s);
        populateForm(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar proveedor');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [params.id, populateForm]);

  // Load KPIs and data in parallel
  useEffect(() => {
    async function loadData() {
      setOrdersLoading(true);

      const [statsRes, sentRes, partialRes, recentRes] =
        await Promise.allSettled([
          api.get<PaginatedResponse<PurchaseOrder>>(
            `/purchase-orders?supplier_id=${params.id}&per_page=1`
          ),
          api.get<PaginatedResponse<PurchaseOrder>>(
            `/purchase-orders?supplier_id=${params.id}&status=sent&per_page=1`
          ),
          api.get<PaginatedResponse<PurchaseOrder>>(
            `/purchase-orders?supplier_id=${params.id}&status=partially_received&per_page=1`
          ),
          api.get<PaginatedResponse<PurchaseOrder>>(
            `/purchase-orders?supplier_id=${params.id}&per_page=10`
          ),
        ]);

      // Total orders
      if (statsRes.status === 'fulfilled') {
        setTotalOrders(statsRes.value.total);
      }

      // Pending orders (sent + partially_received)
      let pending = 0;
      if (sentRes.status === 'fulfilled') pending += sentRes.value.total;
      if (partialRes.status === 'fulfilled') pending += partialRes.value.total;
      setPendingOrders(pending);

      // Recent orders + last order date
      if (recentRes.status === 'fulfilled') {
        const orders = recentRes.value.data ?? [];
        setRecentOrders(orders);
        if (orders.length > 0) {
          setLastOrderDate(orders[0].created_at);
        }
      }
      setOrdersLoading(false);
    }

    loadData();
    fetchProducts();
  }, [params.id, fetchProducts]);

  const handleEdit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const body = {
        name: formName,
        contact_name: formContactName || undefined,
        phone: formPhone || undefined,
        email: formEmail || undefined,
      };
      const updated = await api.put<Supplier>(`/suppliers/${params.id}`, body);
      setSupplier(updated);
      setEditOpen(false);
      toast.success('Proveedor actualizado correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Error state ---
  if (error || !supplier) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push('/proveedores')}>
          Volver a proveedores
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? 'Proveedor no encontrado'}
        </div>
      </div>
    );
  }

  const filteredProducts = products.filter((sp) => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return (
      sp.product_name.toLowerCase().includes(q) ||
      sp.product_sku.toLowerCase().includes(q) ||
      (sp.supplier_sku && sp.supplier_sku.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6" data-testid="supplier-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/proveedores')}
          >
            &larr; Volver a proveedores
          </Button>
          <h1 className="text-2xl font-bold">{supplier.name}</h1>
          <Badge variant={supplier.is_active ? 'default' : 'secondary'}>
            {supplier.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
        </div>
        <Button onClick={() => { populateForm(supplier); setEditOpen(true); }}>
          Editar
        </Button>
      </div>

      {/* Section 1: Contact info */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion de contacto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Nombre de contacto:</span>{' '}
              <span className="font-medium">
                {supplier.contact_name || <span className="text-muted-foreground">No especificado</span>}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Telefono:</span>{' '}
              <span className="font-medium">
                {supplier.phone || <span className="text-muted-foreground">No especificado</span>}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Email:</span>{' '}
              <span className="font-medium">
                {supplier.email || <span className="text-muted-foreground">No especificado</span>}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Total de ordenes" value={totalOrders} />
        <KpiCard
          title="Ordenes pendientes"
          value={pendingOrders}
          description="Enviadas + parcialmente recibidas"
        />
        <KpiCard
          title="Ultima orden"
          value={lastOrderDate ? formatShortDate(lastOrderDate) : 'Sin ordenes'}
        />
        <KpiCard title="Productos vinculados" value={productsCount} />
      </div>

      {/* Section 3: Recent orders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Ordenes recientes</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/proveedores/ordenes?supplier_id=${params.id}`}>
                Ver todas las ordenes &rarr;
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ordersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                </div>
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No hay ordenes registradas
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numero de orden</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Fecha esperada</TableHead>
                  <TableHead className="text-right">Creado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((po) => {
                  const config = STATUS_CONFIG[po.status] ?? {
                    label: po.status,
                    className: '',
                  };
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono font-medium">
                        {po.order_number}
                      </TableCell>
                      <TableCell>
                        <Badge className={config.className}>
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {po.total_amount != null
                          ? `$${po.total_amount.toFixed(2)}`
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        {po.expected_delivery_date
                          ? formatShortDate(po.expected_delivery_date)
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatShortDate(po.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Supplier products */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Productos del proveedor</CardTitle>
              <CardDescription>
                {productsCount} producto{productsCount !== 1 ? 's' : ''} vinculado{productsCount !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <Button size="sm" onClick={openLinkDialog}>
              + Vincular producto
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {productsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <HugeiconsIcon icon={Package01Icon} className="size-12 text-muted-foreground/50 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">
                No hay productos vinculados a este proveedor.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Vincula productos para poder crear ordenes de compra.
              </p>
              <Button size="sm" className="mt-4" onClick={openLinkDialog}>
                + Vincular producto
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Input
                  placeholder="Buscar por nombre o SKU..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>SKU Proveedor</TableHead>
                    <TableHead>Costo unitario</TableHead>
                    <TableHead>Dias entrega</TableHead>
                    <TableHead>Pedido min.</TableHead>
                    <TableHead>Preferido</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((sp) => (
                    <TableRow key={sp.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{sp.product_name}</span>
                          <span className="ml-2 font-mono text-sm text-muted-foreground">
                            {sp.product_sku}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {sp.supplier_sku || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>${sp.unit_cost.toFixed(2)}</TableCell>
                      <TableCell>{sp.lead_time_days} dias</TableCell>
                      <TableCell>{sp.minimum_order_qty}</TableCell>
                      <TableCell>
                        {sp.is_preferred ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            Si
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setUnlinkTarget(sp)}
                        >
                          Desvincular
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 5: Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion de auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Creado el:</span>{' '}
              <span className="font-medium">{formatDate(supplier.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Ultima actualizacion:</span>{' '}
              <span className="font-medium">{formatDate(supplier.updated_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar proveedor</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nombre</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre del proveedor"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact">Nombre de contacto</Label>
              <Input
                id="edit-contact"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
                placeholder="Nombre del contacto (opcional)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Telefono</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Telefono (opcional)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Email (opcional)"
                />
              </div>
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
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Actualizar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Link Product Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular producto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLinkProduct} className="space-y-4">
            <div className="space-y-2">
              <Label>Producto</Label>
              <Select value={linkProductId || undefined} onValueChange={setLinkProductId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {allProducts
                    .filter((p) => !products.some((sp) => sp.product_id === p.id))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>SKU del proveedor (opcional)</Label>
              <Input
                value={linkSupplierSku}
                onChange={(e) => setLinkSupplierSku(e.target.value)}
                placeholder="SKU del proveedor"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Costo unitario</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={linkUnitCost}
                  onChange={(e) => setLinkUnitCost(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Dias de entrega</Label>
                <Input
                  type="number"
                  min={0}
                  value={linkLeadTime}
                  onChange={(e) => setLinkLeadTime(e.target.value)}
                  required
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Pedido minimo</Label>
                <Input
                  type="number"
                  min={1}
                  value={linkMinOrder}
                  onChange={(e) => setLinkMinOrder(e.target.value)}
                  required
                  placeholder="1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkOpen(false)} disabled={isLinking}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLinking || !linkProductId}>
                {isLinking ? 'Vinculando...' : 'Vincular'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Unlink Confirmation */}
      <ConfirmDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => !open && setUnlinkTarget(null)}
        title="Desvincular producto"
        description={`Se desvinculara "${unlinkTarget?.product_name}" de este proveedor.`}
        onConfirm={handleUnlinkProduct}
        isLoading={isUnlinking}
      />
    </div>
  );
}
