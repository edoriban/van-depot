'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { ProductLot, QualityStatus, PaginatedResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Layers01Icon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { ExportButton } from '@/components/shared/export-button';
import { exportToExcel } from '@/lib/export-utils';

const QUALITY_LABELS: Record<QualityStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  quarantine: 'Cuarentena',
};

const QUALITY_COLORS: Record<QualityStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  quarantine: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

const PER_PAGE = 20;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function LotesPage() {
  const [lots, setLots] = useState<ProductLot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLots = useCallback(async (p: number) => {
    setIsLoading(true);
    try {
      const res = await api.get<PaginatedResponse<ProductLot>>(
        `/lots?page=${p}&per_page=${PER_PAGE}`
      );
      setLots(res.data);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLots(page);
  }, [page, fetchLots]);

  const columns: ColumnDef<ProductLot>[] = [
    {
      key: 'lot_number',
      header: 'No. Lote',
      render: (l) => <span className="font-medium font-mono">{l.lot_number}</span>,
    },
    {
      key: 'product',
      header: 'Producto',
      render: (l) => l.product_id.slice(0, 8) + '...',
    },
    {
      key: 'status',
      header: 'Estado',
      render: (l) => (
        <Badge className={QUALITY_COLORS[l.quality_status]}>
          {QUALITY_LABELS[l.quality_status]}
        </Badge>
      ),
    },
    {
      key: 'received_qty',
      header: 'Cantidad recibida',
      render: (l) => l.received_quantity,
    },
    {
      key: 'total_qty',
      header: 'Cantidad total',
      render: (l) => l.total_quantity,
    },
    {
      key: 'batch_date',
      header: 'Fecha lote',
      render: (l) => formatDate(l.batch_date),
    },
    {
      key: 'expiration',
      header: 'Vencimiento',
      render: (l) => formatDate(l.expiration_date),
    },
    {
      key: 'created',
      header: 'Recibido',
      render: (l) => formatDate(l.created_at),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lotes</h1>
          <p className="text-muted-foreground mt-1">
            Historial de lotes recibidos y su estado de calidad
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            onExport={() =>
              exportToExcel(
                lots as unknown as Record<string, unknown>[],
                'lotes',
                'Lotes',
                [
                  { key: 'lot_number', label: 'No. Lote' },
                  { key: 'product_id', label: 'Producto (ID)' },
                  { key: 'received_quantity', label: 'Cantidad recibida' },
                  { key: 'total_quantity', label: 'Cantidad total' },
                  {
                    key: 'batch_date',
                    label: 'Fecha lote',
                    format: (v) =>
                      v ? new Date(v as string).toLocaleDateString('es-MX') : '-',
                  },
                  {
                    key: 'expiration_date',
                    label: 'Fecha vencimiento',
                    format: (v) =>
                      v ? new Date(v as string).toLocaleDateString('es-MX') : '-',
                  },
                  {
                    key: 'quality_status',
                    label: 'Estado calidad',
                    format: (v) => {
                      const labels: Record<string, string> = {
                        pending: 'Pendiente',
                        approved: 'Aprobado',
                        rejected: 'Rechazado',
                        quarantine: 'Cuarentena',
                      };
                      return labels[v as string] ?? String(v);
                    },
                  },
                  { key: 'notes', label: 'Notas', format: (v) => (v as string) ?? '' },
                  {
                    key: 'created_at',
                    label: 'Recibido',
                    format: (v) =>
                      v ? new Date(v as string).toLocaleDateString('es-MX') : '',
                  },
                ]
              )
            }
            disabled={lots.length === 0}
          />
          <Button asChild>
            <Link href="/lotes/recibir">Recibir material</Link>
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={lots}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay lotes registrados"
        emptyState={
          <EmptyState
            icon={Layers01Icon}
            title="Sin lotes registrados"
            description="Recibe material por lotes para llevar trazabilidad de cada ingreso."
            actionLabel="Recibir material"
            actionHref="/lotes/recibir"
          />
        }
      />
    </div>
  );
}
