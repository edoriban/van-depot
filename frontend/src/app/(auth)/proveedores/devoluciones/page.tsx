'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api } from '@/lib/api-mutations';
import type {
  PurchaseReturn,
  PurchaseReturnStatus,
  PurchaseReturnReason,
  PaginatedResponse,
} from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExportButton } from '@/components/shared/export-button';
import { exportToExcel } from '@/lib/export-utils';
import { DeliveryTruck01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

// --- Status config ---

const STATUS_CONFIG: Record<PurchaseReturnStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pendiente',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
  shipped_to_supplier: {
    label: 'Enviada al proveedor',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  refunded: {
    label: 'Reembolsada',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  rejected: {
    label: 'Rechazada',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
};

const REASON_LABELS: Record<PurchaseReturnReason, string> = {
  damaged: 'Dañado',
  defective: 'Defectuoso',
  wrong_product: 'Producto incorrecto',
  expired: 'Expirado',
  excess_inventory: 'Exceso de inventario',
  other: 'Otro',
};

// --- Main Page ---

function DevolucionesPageInner() {
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PurchaseReturnStatus | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);

  const fetchReturns = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('per_page', '20');
      const res = await api.get<PaginatedResponse<PurchaseReturn>>(
        `/purchase-returns?${params}`
      );
      setReturns(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      toast.error('Error al cargar devoluciones');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  const handleExport = () => {
    exportToExcel(
      returns as unknown as Record<string, unknown>[],
      'devoluciones',
      'Devoluciones',
      [
        { key: 'return_number', label: '# Devolución' },
        { key: 'purchase_order_id', label: 'Orden de Compra' },
        {
          key: 'reason',
          label: 'Razón',
          format: (v) => REASON_LABELS[(v as PurchaseReturnReason)] ?? String(v),
        },
        {
          key: 'status',
          label: 'Estado',
          format: (v) => STATUS_CONFIG[(v as PurchaseReturnStatus)]?.label ?? String(v),
        },
        { key: 'total', label: 'Total', format: (v) => Number(v).toFixed(2) },
        {
          key: 'created_at',
          label: 'Fecha',
          format: (v) =>
            new Date(String(v)).toLocaleDateString('es-MX', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
        },
      ]
    );
  };

  const columns: ColumnDef<PurchaseReturn>[] = [
    {
      key: 'return_number',
      header: '# Devolución',
      render: (r) => (
        <span className="font-mono font-medium">{r.return_number}</span>
      ),
    },
    {
      key: 'purchase_order_id',
      header: 'Orden de Compra',
      render: (r) => (
        <span className="font-mono text-muted-foreground">
          {r.purchase_order_id.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Razón',
      render: (r) => <span>{REASON_LABELS[r.reason] ?? r.reason}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => {
        const config = STATUS_CONFIG[r.status];
        return <Badge className={config.className}>{config.label}</Badge>;
      },
    },
    {
      key: 'total',
      header: 'Total',
      render: (r) => `$${r.total.toFixed(2)}`,
    },
    {
      key: 'created_at',
      header: 'Fecha',
      render: (r) =>
        new Date(r.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Devoluciones a Proveedores</h1>
          <p className="text-muted-foreground mt-1">
            Historial de devoluciones de productos a proveedores
          </p>
        </div>
        <ExportButton onExport={handleExport} disabled={returns.length === 0} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Estado:</Label>
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val as PurchaseReturnStatus | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="shipped_to_supplier">Enviada al proveedor</SelectItem>
              <SelectItem value="refunded">Reembolsada</SelectItem>
              <SelectItem value="rejected">Rechazada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={returns}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay devoluciones registradas"
        emptyState={
          <EmptyState
            icon={DeliveryTruck01Icon}
            title="Aun no hay devoluciones"
            description="Las devoluciones a proveedores aparecerán aquí una vez que se creen desde las órdenes de compra."
          />
        }
      />
    </div>
  );
}

export default function DevolucionesPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando...</div>}>
      <DevolucionesPageInner />
    </Suspense>
  );
}
