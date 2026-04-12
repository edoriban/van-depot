'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { Supplier, SupplierProduct, Product, PaginatedResponse, PurchaseOrder } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DeliveryTruck01Icon, Package01Icon } from '@hugeicons/core-free-icons';
import { ExportButton } from '@/components/shared/export-button';
import { exportToExcel } from '@/lib/export-utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import Link from 'next/link';

// --- Supplier Products Dialog ---

function SupplierProductsDialog({
  supplier,
  open,
  onOpenChange,
}: {
  supplier: Supplier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  // All products for linking
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  // Link form state
  const [linkProductId, setLinkProductId] = useState('');
  const [linkSupplierSku, setLinkSupplierSku] = useState('');
  const [linkUnitCost, setLinkUnitCost] = useState('');
  const [linkLeadTime, setLinkLeadTime] = useState('');
  const [linkMinOrder, setLinkMinOrder] = useState('1');
  const [isLinking, setIsLinking] = useState(false);

  // Delete state
  const [unlinkTarget, setUnlinkTarget] = useState<SupplierProduct | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!supplier) return;
    setIsLoading(true);
    try {
      const res = await api.get<SupplierProduct[]>(
        `/suppliers/${supplier.id}/products`
      );
      setProducts(Array.isArray(res) ? res : []);
    } catch {
      toast.error('Error al cargar productos del proveedor');
    } finally {
      setIsLoading(false);
    }
  }, [supplier]);

  const fetchAllProducts = useCallback(async () => {
    try {
      const res = await api.get<Product[] | PaginatedResponse<Product>>('/products');
      setAllProducts(Array.isArray(res) ? res : res.data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (open && supplier) {
      fetchProducts();
      fetchAllProducts();
    }
  }, [open, supplier, fetchProducts, fetchAllProducts]);

  const handleLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supplier) return;
    setIsLinking(true);
    try {
      await api.post(`/suppliers/${supplier.id}/products`, {
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

  const handleUnlink = async () => {
    if (!unlinkTarget || !supplier) return;
    setIsUnlinking(true);
    try {
      await api.del(`/suppliers/${supplier.id}/products/${unlinkTarget.id}`);
      toast.success('Producto desvinculado');
      setUnlinkTarget(null);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al desvincular');
    } finally {
      setIsUnlinking(false);
    }
  };

  const columns: ColumnDef<SupplierProduct>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (sp) => (
        <div>
          <span className="font-medium">{sp.product_name}</span>
          <span className="ml-2 font-mono text-sm text-muted-foreground">{sp.product_sku}</span>
        </div>
      ),
    },
    {
      key: 'supplier_sku',
      header: 'SKU Proveedor',
      render: (sp) => sp.supplier_sku || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'unit_cost',
      header: 'Costo unitario',
      render: (sp) => `$${sp.unit_cost.toFixed(2)}`,
    },
    {
      key: 'lead_time',
      header: 'Tiempo entrega',
      render: (sp) => `${sp.lead_time_days} dias`,
    },
    {
      key: 'min_order',
      header: 'Pedido min.',
      render: (sp) => sp.minimum_order_qty,
    },
    {
      key: 'preferred',
      header: 'Preferido',
      render: (sp) =>
        sp.is_preferred ? (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Si
          </Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (sp) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setUnlinkTarget(sp)}
        >
          Desvincular
        </Button>
      ),
    },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Productos de {supplier?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {products.length} producto{products.length !== 1 ? 's' : ''} vinculado{products.length !== 1 ? 's' : ''}
              </p>
              <Button size="sm" onClick={() => setLinkOpen(true)}>
                Vincular producto
              </Button>
            </div>
            <Input
              placeholder="Buscar producto por nombre o SKU..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="max-w-sm"
            />
            <DataTable
              columns={columns}
              data={products.filter((sp) => {
                if (!productSearch) return true;
                const q = productSearch.toLowerCase();
                return (
                  sp.product_name.toLowerCase().includes(q) ||
                  sp.product_sku.toLowerCase().includes(q) ||
                  (sp.supplier_sku && sp.supplier_sku.toLowerCase().includes(q))
                );
              })}
              total={products.length}
              page={1}
              perPage={100}
              onPageChange={() => {}}
              isLoading={isLoading}
              emptyMessage="No hay productos vinculados"
              emptyState={
                <EmptyState
                  icon={Package01Icon}
                  title="Sin productos vinculados"
                  description="Vincula productos a este proveedor para registrar costos y tiempos de entrega."
                  actionLabel="Vincular producto"
                  onAction={() => setLinkOpen(true)}
                />
              }
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Product Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular producto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLink} className="space-y-4">
            <div className="space-y-2">
              <Label>Producto</Label>
              <Select value={linkProductId || undefined} onValueChange={setLinkProductId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {allProducts.map((p) => (
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
                <Label>Dias entrega</Label>
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
                <Label>Pedido min.</Label>
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
        onConfirm={handleUnlink}
        isLoading={isUnlinking}
      />
    </>
  );
}

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

  // Products dialog state
  const [productsSupplier, setProductsSupplier] = useState<Supplier | null>(null);

  // Pending orders count per supplier
  const [pendingBySupplier, setPendingBySupplier] = useState<Map<string, number>>(new Map());

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

  const fetchPendingOrders = useCallback(async () => {
    try {
      const [sentRes, partialRes] = await Promise.all([
        api.get<PaginatedResponse<PurchaseOrder>>('/purchase-orders?status=sent&per_page=100'),
        api.get<PaginatedResponse<PurchaseOrder>>('/purchase-orders?status=partially_received&per_page=100'),
      ]);
      const map = new Map<string, number>();
      const allPending = [...sentRes.data, ...partialRes.data];
      allPending.forEach((o) => {
        map.set(o.supplier_id, (map.get(o.supplier_id) || 0) + 1);
      });
      setPendingBySupplier(map);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchSuppliers(page);
  }, [page, fetchSuppliers]);

  useEffect(() => {
    fetchPendingOrders();
  }, [fetchPendingOrders]);

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
      render: (s) => (
        <Link
          href={`/proveedores/${s.id}`}
          className="font-bold text-foreground hover:underline"
          data-testid="supplier-detail-link"
        >
          {s.name}
        </Link>
      ),
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
      key: 'pending',
      header: 'Pendientes',
      render: (s) => {
        const count = pendingBySupplier.get(s.id);
        if (!count) return <span className="text-muted-foreground">-</span>;
        return (
          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
            {count} pendiente{count !== 1 ? 's' : ''}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (s) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
          >
            <Link href={`/proveedores/ordenes?supplier_id=${s.id}`}>
              Ver ordenes
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProductsSupplier(s)}
            data-testid="supplier-products-btn"
          >
            Productos
          </Button>
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
        <div className="flex items-center gap-2">
          <ExportButton
            onExport={() =>
              exportToExcel(
                suppliers as unknown as Record<string, unknown>[],
                'proveedores',
                'Proveedores',
                [
                  { key: 'name', label: 'Nombre' },
                  { key: 'contact_name', label: 'Contacto', format: (v) => (v as string) ?? '' },
                  { key: 'email', label: 'Email', format: (v) => (v as string) ?? '' },
                  { key: 'phone', label: 'Telefono', format: (v) => (v as string) ?? '' },
                  {
                    key: 'is_active',
                    label: 'Activo',
                    format: (v) => (v ? 'Si' : 'No'),
                  },
                  {
                    key: 'id',
                    label: 'Ordenes pendientes',
                    format: (_v, row) => {
                      const s = row as unknown as Supplier;
                      return pendingBySupplier.get(s.id) ?? 0;
                    },
                  },
                ]
              )
            }
            disabled={suppliers.length === 0}
          />
          <Button onClick={openCreateDialog} data-testid="new-supplier-btn">
            Nuevo proveedor
          </Button>
        </div>
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
        emptyState={
          <EmptyState
            icon={DeliveryTruck01Icon}
            title="Aun no tienes proveedores"
            description="Registra a tus proveedores para un mejor control."
            actionLabel="Nuevo proveedor"
            onAction={openCreateDialog}
          />
        }
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

      {/* Supplier Products Dialog */}
      <SupplierProductsDialog
        supplier={productsSupplier}
        open={!!productsSupplier}
        onOpenChange={(open) => !open && setProductsSupplier(null)}
      />
    </div>
  );
}
