'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  SupplierProduct,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { toast } from 'sonner';
import Link from 'next/link';

// --- Status config (duplicated locally, same pattern as supplier detail) ---

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: 'Borrador',
    className:
      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  sent: {
    label: 'Enviada',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  partially_received: {
    label: 'Parcial',
    className:
      'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
  completed: {
    label: 'Completada',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  cancelled: {
    label: 'Cancelada',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
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

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// --- Progress bar for line reception ---

function ReceptionProgress({
  received,
  ordered,
}: {
  received: number;
  ordered: number;
}) {
  const ratio = ordered > 0 ? received / ordered : 0;
  const percentage = Math.min(ratio * 100, 100);

  let barColor = 'bg-gray-300 dark:bg-gray-600';
  if (ratio > 1) {
    barColor = 'bg-red-500';
  } else if (ratio >= 1) {
    barColor = 'bg-green-500';
  } else if (ratio > 0) {
    barColor = 'bg-amber-500';
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {received}/{ordered}
      </span>
    </div>
  );
}

// --- Main page ---

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useRouter();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Confirm dialogs
  const [sendOpen, setSendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Phase 6: Edit PO dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editExpectedDate, setEditExpectedDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  // Phase 7: Add line dialog
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addLineProductId, setAddLineProductId] = useState('');
  const [addLineQty, setAddLineQty] = useState('');
  const [addLinePrice, setAddLinePrice] = useState('');
  const [addLineNotes, setAddLineNotes] = useState('');
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [isAddLineSubmitting, setIsAddLineSubmitting] = useState(false);

  // Phase 8: Edit line dialog
  const [editLineOpen, setEditLineOpen] = useState(false);
  const [editLineTarget, setEditLineTarget] = useState<PurchaseOrderLine | null>(null);
  const [editLineQty, setEditLineQty] = useState('');
  const [editLinePrice, setEditLinePrice] = useState('');
  const [editLineNotes, setEditLineNotes] = useState('');
  const [isEditLineSubmitting, setIsEditLineSubmitting] = useState(false);

  // Phase 9: Delete line confirm
  const [deleteLineTarget, setDeleteLineTarget] = useState<PurchaseOrderLine | null>(null);
  const [isDeletingLine, setIsDeletingLine] = useState(false);

  const fetchOrder = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const po = await api.get<PurchaseOrder>(
        `/purchase-orders/${params.id}`,
      );
      setPurchaseOrder(po);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al cargar la orden',
      );
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // --- Actions ---

  const handleSend = async () => {
    setIsSending(true);
    try {
      await api.post(`/purchase-orders/${params.id}/send`);
      toast.success('Orden enviada correctamente');
      setSendOpen(false);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al enviar la orden',
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await api.post(`/purchase-orders/${params.id}/cancel`);
      toast.success('Orden cancelada');
      setCancelOpen(false);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cancelar la orden',
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // --- Phase 6: Edit PO handler ---
  const openEditDialog = () => {
    if (!purchaseOrder) return;
    setEditExpectedDate(purchaseOrder.expected_delivery_date?.split('T')[0] ?? '');
    setEditNotes(purchaseOrder.notes ?? '');
    setEditDialogOpen(true);
  };

  const handleEditPO = async () => {
    setIsEditSubmitting(true);
    try {
      await api.put(`/purchase-orders/${params.id}`, {
        expected_delivery_date: editExpectedDate || undefined,
        notes: editNotes || undefined,
      });
      toast.success('Orden actualizada correctamente');
      setEditDialogOpen(false);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al actualizar la orden',
      );
    } finally {
      setIsEditSubmitting(false);
    }
  };

  // --- Phase 7: Add line handler ---
  const openAddLineDialog = () => {
    setAddLineProductId('');
    setAddLineQty('');
    setAddLinePrice('');
    setAddLineNotes('');
    setAddLineOpen(true);
    // Fetch supplier-linked products
    if (purchaseOrder?.supplier_id) {
      api
        .get<SupplierProduct[]>(`/suppliers/${purchaseOrder.supplier_id}/products`)
        .then((res) => setSupplierProducts(Array.isArray(res) ? res : []))
        .catch(() => {});
    }
  };

  const handleAddLine = async () => {
    if (!addLineProductId || !addLineQty) {
      toast.error('Selecciona un producto y cantidad');
      return;
    }
    setIsAddLineSubmitting(true);
    try {
      await api.post(`/purchase-orders/${params.id}/lines`, {
        product_id: addLineProductId,
        quantity_ordered: Number(addLineQty),
        unit_price: Number(addLinePrice) || 0,
        notes: addLineNotes || undefined,
      });
      toast.success('Linea agregada correctamente');
      setAddLineOpen(false);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al agregar linea',
      );
    } finally {
      setIsAddLineSubmitting(false);
    }
  };

  // --- Phase 8: Edit line handler ---
  const openEditLineDialog = (line: PurchaseOrderLine) => {
    setEditLineTarget(line);
    setEditLineQty(String(line.quantity_ordered));
    setEditLinePrice(String(line.unit_price));
    setEditLineNotes(line.notes ?? '');
    setEditLineOpen(true);
  };

  const handleEditLine = async () => {
    if (!editLineTarget) return;
    setIsEditLineSubmitting(true);
    try {
      await api.put(
        `/purchase-orders/${params.id}/lines/${editLineTarget.id}`,
        {
          quantity_ordered: Number(editLineQty),
          unit_price: Number(editLinePrice),
          notes: editLineNotes || undefined,
        },
      );
      toast.success('Linea actualizada correctamente');
      setEditLineOpen(false);
      setEditLineTarget(null);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al actualizar linea',
      );
    } finally {
      setIsEditLineSubmitting(false);
    }
  };

  // --- Phase 9: Delete line handler ---
  const handleDeleteLine = async () => {
    if (!deleteLineTarget) return;
    setIsDeletingLine(true);
    try {
      await api.del(`/purchase-orders/${params.id}/lines/${deleteLineTarget.id}`);
      toast.success('Linea eliminada correctamente');
      setDeleteLineTarget(null);
      await fetchOrder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al eliminar linea',
      );
    } finally {
      setIsDeletingLine(false);
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
  if (error || !purchaseOrder) {
    return (
      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={() => push('/proveedores/ordenes')}
        >
          Volver a ordenes
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? 'Orden no encontrada'}
        </div>
      </div>
    );
  }

  const po = purchaseOrder;
  const lines: PurchaseOrderLine[] = po.lines ?? [];
  const statusConfig = STATUS_CONFIG[po.status] ?? {
    label: po.status,
    className: '',
  };

  // KPI calculations
  const completedLines = lines.filter(
    (l) => l.quantity_received >= l.quantity_ordered,
  ).length;
  const receptionText =
    lines.length > 0
      ? `${completedLines}/${lines.length} completas`
      : 'Sin lineas';
  const receptionPercentage =
    lines.length > 0 ? Math.round((completedLines / lines.length) * 100) : 0;

  // Status-dependent actions
  const canSend = po.status === 'draft';
  const canCancel: boolean =
    po.status === 'draft' ||
    po.status === 'sent' ||
    po.status === 'partially_received';

  return (
    <div className="space-y-6" data-testid="purchase-order-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => push('/proveedores/ordenes')}
          >
            &larr; Volver a ordenes
          </Button>
          <h1 className="text-2xl font-semibold font-mono">
            {po.order_number}
          </h1>
          <Badge className={statusConfig.className}>
            {statusConfig.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canSend && (
            <>
              <Button variant="outline" onClick={openEditDialog}>
                Editar
              </Button>
              <Button onClick={() => setSendOpen(true)}>Enviar</Button>
            </>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              onClick={() => setCancelOpen(true)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Supplier link */}
      {po.supplier_name && (
        <p className="text-sm text-muted-foreground">
          Proveedor:{' '}
          <Link
            href={`/proveedores/${po.supplier_id}`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {po.supplier_name}
          </Link>
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Total"
          value={
            po.total_amount != null ? formatCurrency(po.total_amount) : '-'
          }
        />
        <KpiCard title="Lineas" value={lines.length} />
        <KpiCard
          title="Recepcion"
          value={`${receptionPercentage}%`}
          description={receptionText}
        />
        <KpiCard
          title="Fecha esperada"
          value={
            po.expected_delivery_date
              ? formatShortDate(po.expected_delivery_date)
              : 'Sin fecha'
          }
        />
      </div>

      {/* Lines table */}
      <Card>
        <CardHeader>
          <CardTitle>Lineas de la orden</CardTitle>
          <CardDescription>
            {lines.length} linea{lines.length !== 1 ? 's' : ''} en esta
            orden
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">
                {po.status === 'draft'
                  ? 'No hay lineas en esta orden. Agrega productos para comenzar.'
                  : 'No hay lineas en esta orden'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">
                    Cant. ordenada
                  </TableHead>
                  <TableHead className="text-right">
                    Cant. recibida
                  </TableHead>
                  <TableHead className="text-right">
                    Precio unit.
                  </TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead>Progreso</TableHead>
                  {po.status === 'draft' && (
                    <TableHead className="text-right">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const subtotal =
                    line.quantity_ordered * line.unit_price;
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">
                            {line.product_name ?? 'Producto'}
                          </span>
                          {line.product_sku && (
                            <span className="ml-2 font-mono text-sm text-muted-foreground">
                              {line.product_sku}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {line.quantity_ordered}
                      </TableCell>
                      <TableCell className="text-right">
                        {line.quantity_received}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(line.unit_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(subtotal)}
                      </TableCell>
                      <TableCell>
                        <ReceptionProgress
                          received={line.quantity_received}
                          ordered={line.quantity_ordered}
                        />
                      </TableCell>
                      {po.status === 'draft' && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditLineDialog(line)}
                            >
                              Editar
                            </Button>
                            {line.quantity_received === 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                onClick={() => setDeleteLineTarget(line)}
                              >
                                Eliminar
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {po.status === 'draft' && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={openAddLineDialog}
              >
                + Agregar linea
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Notas</CardTitle>
        </CardHeader>
        <CardContent>
          {po.notes ? (
            <p className="text-sm whitespace-pre-wrap">{po.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin notas</p>
          )}
        </CardContent>
      </Card>

      {/* Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion de auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Creado el:</span>{' '}
              <span className="font-medium">
                {formatDate(po.created_at)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">
                Ultima actualizacion:
              </span>{' '}
              <span className="font-medium">
                {formatDate(po.updated_at)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirm: Send */}
      <ConfirmDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        title="Enviar orden de compra"
        description={`¿Deseas marcar la orden ${po.order_number} como enviada? Esto cambiara su estado a "Enviada".`}
        onConfirm={handleSend}
        isLoading={isSending}
        confirmLabel="Enviar"
      />

      {/* Confirm: Cancel */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar orden de compra"
        description={`¿Deseas cancelar la orden ${po.order_number}? Esta accion no se puede deshacer.`}
        onConfirm={handleCancel}
        isLoading={isCancelling}
        confirmLabel="Cancelar orden"
      />

      {/* Phase 6: Edit PO Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar orden de compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fecha esperada de entrega</Label>
              <Input
                type="date"
                value={editExpectedDate}
                onChange={(e) => setEditExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Observaciones generales"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={isEditSubmitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleEditPO} disabled={isEditSubmitting}>
              {isEditSubmitting ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 7: Add Line Dialog */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar linea</DialogTitle>
          </DialogHeader>
          {supplierProducts.length === 0 && addLineOpen ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Este proveedor no tiene productos vinculados.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/proveedores/${purchaseOrder.supplier_id}`}>
                  Ir a gestion de proveedor &rarr;
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Producto</Label>
                  <SearchableSelect
                    value={addLineProductId || undefined}
                    onValueChange={(val) => {
                      setAddLineProductId(val);
                      const sp = supplierProducts.find((p) => p.product_id === val);
                      if (sp) {
                        setAddLinePrice(String(sp.unit_cost));
                      }
                    }}
                    options={supplierProducts.reduce<
                      Array<{ value: string; label: string }>
                    >((acc, p) => {
                      if (!p.is_active) return acc;
                      if (lines.some((l) => l.product_id === p.product_id)) return acc;
                      acc.push({
                        value: p.product_id,
                        label: p.supplier_sku
                          ? `${p.product_name} (SKU: ${p.product_sku} / Proveedor: ${p.supplier_sku})`
                          : `${p.product_name} (${p.product_sku})`,
                      });
                      return acc;
                    }, [])}
                    placeholder="Seleccionar producto"
                    searchPlaceholder="Buscar producto..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cantidad</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      value={addLineQty}
                      onChange={(e) => setAddLineQty(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Precio unitario</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={addLinePrice}
                      onChange={(e) => setAddLinePrice(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    rows={2}
                    value={addLineNotes}
                    onChange={(e) => setAddLineNotes(e.target.value)}
                    placeholder="Notas de la linea"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddLineOpen(false)}
                  disabled={isAddLineSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleAddLine}
                  disabled={isAddLineSubmitting || !addLineProductId || !addLineQty}
                >
                  {isAddLineSubmitting ? 'Agregando...' : 'Agregar linea'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Phase 8: Edit Line Dialog */}
      <Dialog
        open={editLineOpen}
        onOpenChange={(open) => {
          setEditLineOpen(open);
          if (!open) setEditLineTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar linea</DialogTitle>
          </DialogHeader>
          {editLineTarget && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Producto</Label>
                <p className="text-sm font-medium">
                  {editLineTarget.product_name ?? 'Producto'}
                  {editLineTarget.product_sku && (
                    <span className="ml-2 font-mono text-muted-foreground">
                      {editLineTarget.product_sku}
                    </span>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min={0.01}
                    step="any"
                    value={editLineQty}
                    onChange={(e) => setEditLineQty(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Precio unitario</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editLinePrice}
                    onChange={(e) => setEditLinePrice(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notas (opcional)</Label>
                <Textarea
                  rows={2}
                  value={editLineNotes}
                  onChange={(e) => setEditLineNotes(e.target.value)}
                  placeholder="Notas de la linea"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditLineOpen(false);
                setEditLineTarget(null);
              }}
              disabled={isEditLineSubmitting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleEditLine}
              disabled={isEditLineSubmitting || !editLineQty}
            >
              {isEditLineSubmitting ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 9: Delete Line Confirm */}
      <ConfirmDialog
        open={!!deleteLineTarget}
        onOpenChange={(open) => !open && setDeleteLineTarget(null)}
        title="Eliminar linea"
        description={`¿Deseas eliminar la linea de "${deleteLineTarget?.product_name ?? 'este producto'}"? Esta accion no se puede deshacer.`}
        onConfirm={handleDeleteLine}
        isLoading={isDeletingLine}
        confirmLabel="Eliminar"
      />
    </div>
  );
}
