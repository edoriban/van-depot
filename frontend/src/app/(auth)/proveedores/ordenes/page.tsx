'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  Supplier,
  Product,
  PaginatedResponse,
} from '@/types';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { DeliveryTruck01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

// --- Status config ---

const STATUS_CONFIG: Record<
  PurchaseOrderStatus,
  { label: string; className: string }
> = {
  draft: { label: 'Borrador', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  sent: { label: 'Enviada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  partially_received: { label: 'Parcial', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  completed: { label: 'Completada', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  cancelled: { label: 'Cancelada', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

// --- Create Purchase Order Dialog ---

function CreatePurchaseOrderDialog({
  open,
  onOpenChange,
  suppliers,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  onSuccess: () => void;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<
    Array<{ product_id: string; quantity_ordered: string; unit_price: string; notes: string }>
  >([{ product_id: '', quantity_ordered: '', unit_price: '', notes: '' }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      api
        .get<Product[] | PaginatedResponse<Product>>('/products')
        .then((res) => setProducts(Array.isArray(res) ? res : res.data))
        .catch(() => {});
    }
  }, [open]);

  const total = useMemo(() => {
    return lines.reduce((sum, l) => {
      const qty = parseFloat(l.quantity_ordered) || 0;
      const price = parseFloat(l.unit_price) || 0;
      return sum + qty * price;
    }, 0);
  }, [lines]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { product_id: '', quantity_ordered: '', unit_price: '', notes: '' },
    ]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (
    idx: number,
    field: string,
    value: string
  ) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  };

  const resetForm = () => {
    setSupplierId('');
    setExpectedDate('');
    setNotes('');
    setLines([{ product_id: '', quantity_ordered: '', unit_price: '', notes: '' }]);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supplierId) {
      toast.error('Selecciona un proveedor');
      return;
    }
    const validLines = lines.filter(
      (l) => l.product_id && Number(l.quantity_ordered) > 0
    );
    if (validLines.length === 0) {
      toast.error('Agrega al menos una linea con producto y cantidad');
      return;
    }
    setIsSubmitting(true);
    try {
      const po = await api.post<PurchaseOrder>('/purchase-orders', {
        supplier_id: supplierId,
        expected_delivery_date: expectedDate || undefined,
        notes: notes || undefined,
      });

      const failedLines: number[] = [];
      await Promise.all(
        validLines.map(async (l, idx) => {
          try {
            await api.post(`/purchase-orders/${po.id}/lines`, {
              product_id: l.product_id,
              quantity_ordered: Number(l.quantity_ordered),
              unit_price: Number(l.unit_price) || 0,
              notes: l.notes || undefined,
            });
          } catch {
            failedLines.push(idx + 1);
          }
        })
      );

      if (failedLines.length > 0) {
        toast.warning(
          `Orden creada pero fallaron las lineas: ${failedLines.join(', ')}`
        );
      } else {
        toast.success('Orden de compra creada correctamente');
      }
      onOpenChange(false);
      resetForm();
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al crear orden de compra'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva orden de compra</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <SearchableSelect
                value={supplierId || undefined}
                onValueChange={setSupplierId}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Seleccionar proveedor"
                searchPlaceholder="Buscar proveedor..."
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha esperada de entrega (opcional)</Label>
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones generales"
            />
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Lineas de la orden</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                + Agregar linea
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border p-3">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Producto</Label>
                    <SearchableSelect
                      value={line.product_id || undefined}
                      onValueChange={(val) => updateLine(idx, 'product_id', val)}
                      options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                      placeholder="Seleccionar"
                      searchPlaceholder="Buscar producto..."
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      value={line.quantity_ordered}
                      onChange={(e) => updateLine(idx, 'quantity_ordered', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Precio unit.</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Subtotal</Label>
                    <div className="h-9 flex items-center text-sm font-medium text-muted-foreground">
                      ${((parseFloat(line.quantity_ordered) || 0) * (parseFloat(line.unit_price) || 0)).toFixed(2)}
                    </div>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive h-9"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                    >
                      &times;
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end text-sm font-semibold">
              Total estimado: ${total.toFixed(2)}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); resetForm(); }}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !supplierId}>
              {isSubmitting ? 'Creando...' : 'Crear orden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page ---

function OrdenesPageInner() {
  const searchParams = useSearchParams();
  const initialSupplierId = searchParams.get('supplier_id') || '';

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Load suppliers for filter
  useEffect(() => {
    api
      .get<Supplier[] | PaginatedResponse<Supplier>>('/suppliers')
      .then((res) => setSuppliers(Array.isArray(res) ? res : res.data))
      .catch(() => {});
  }, []);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (supplierFilter) params.set('supplier_id', supplierFilter);
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      params.set('page', String(page));
      params.set('per_page', '20');
      const res = await api.get<PaginatedResponse<PurchaseOrder>>(
        `/purchase-orders?${params}`
      );
      setOrders(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      toast.error('Error al cargar ordenes de compra');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, supplierFilter, fromDate, toDate, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSend = async (po: PurchaseOrder) => {
    try {
      await api.post(`/purchase-orders/${po.id}/send`);
      toast.success(`Orden ${po.order_number} enviada`);
      fetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar orden');
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      await api.post(`/purchase-orders/${cancelTarget.id}/cancel`);
      toast.success(`Orden ${cancelTarget.order_number} cancelada`);
      setCancelTarget(null);
      fetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cancelar orden');
    } finally {
      setIsCancelling(false);
    }
  };

  const columns: ColumnDef<PurchaseOrder>[] = [
    {
      key: 'order_number',
      header: 'Numero de orden',
      render: (po) => (
        <span className="font-mono font-medium">{po.order_number}</span>
      ),
    },
    {
      key: 'supplier',
      header: 'Proveedor',
      render: (po) => (
        <span>{po.supplier_name ?? po.supplier_id.slice(0, 8) + '...'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (po) => {
        const config = STATUS_CONFIG[po.status];
        return (
          <Badge className={config.className}>{config.label}</Badge>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      render: (po) =>
        po.total_amount != null
          ? `$${po.total_amount.toFixed(2)}`
          : <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'expected_delivery_date',
      header: 'Fecha esperada',
      render: (po) =>
        po.expected_delivery_date
          ? new Date(po.expected_delivery_date).toLocaleDateString('es-MX')
          : <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'created_at',
      header: 'Creado',
      render: (po) =>
        new Date(po.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (po) => (
        <div className="flex items-center gap-2">
          {po.status === 'draft' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSend(po)}
            >
              Enviar
            </Button>
          )}
          {(po.status === 'draft' ||
            po.status === 'sent' ||
            po.status === 'partially_received') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setCancelTarget(po)}
            >
              Cancelar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ordenes de Compra</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona las ordenes de compra a tus proveedores
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Nueva orden</Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Estado:</Label>
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val as PurchaseOrderStatus | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="draft">Borrador</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="partially_received">Parcial</SelectItem>
              <SelectItem value="completed">Completada</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Proveedor:</Label>
          <SearchableSelect
            value={supplierFilter || 'all'}
            onValueChange={(val) => {
              setSupplierFilter(val === 'all' ? '' : val);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'Todos los proveedores' },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            placeholder="Todos los proveedores"
            searchPlaceholder="Buscar proveedor..."
            className="w-52"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Desde:</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Hasta:</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={orders}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay ordenes de compra"
        emptyState={
          <EmptyState
            icon={DeliveryTruck01Icon}
            title="Aun no hay ordenes de compra"
            description="Crea tu primera orden de compra para empezar a rastrear recepciones."
            actionLabel="Nueva orden"
            onAction={() => setCreateOpen(true)}
          />
        }
      />

      <CreatePurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        suppliers={suppliers}
        onSuccess={fetchOrders}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancelar orden de compra"
        description={`Se cancelara la orden "${cancelTarget?.order_number}". Esta accion no se puede deshacer.`}
        onConfirm={handleCancel}
        isLoading={isCancelling}
      />
    </div>
  );
}

export default function OrdenesPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando...</div>}>
      <OrdenesPageInner />
    </Suspense>
  );
}
