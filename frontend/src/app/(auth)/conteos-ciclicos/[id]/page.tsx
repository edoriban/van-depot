'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type { CycleCountStatus } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface CycleCountDetail {
  id: string;
  warehouse_id: string;
  warehouse_name?: string;
  name: string;
  status: CycleCountStatus;
  notes?: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  summary?: {
    total_items: number;
    counted: number;
    pending: number;
    with_discrepancy: number;
  };
}

interface CycleCountItem {
  id: string;
  cycle_count_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  location_id: string;
  location_name: string;
  system_quantity: number;
  counted_quantity: number | null;
  difference: number | null;
}

const STATUS_LABELS: Record<CycleCountStatus, string> = {
  draft: 'Borrador',
  in_progress: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<CycleCountStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const PER_PAGE = 20;

function SummaryCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold" data-testid={testId}>
        {value}
      </p>
    </Card>
  );
}

export default function CycleCountDetailPage() {
  const params = useParams();
  const { push } = useRouter();
  const countId = params.id as string;

  const [count, setCount] = useState<CycleCountDetail | null>(null);
  const [items, setItems] = useState<CycleCountItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline edit state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [isCounting, setIsCounting] = useState(false);

  // Discrepancy filter
  const [showDiscrepanciesOnly, setShowDiscrepanciesOnly] = useState(false);

  // Confirm dialogs
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const res = await api.get<CycleCountDetail>(`/cycle-counts/${countId}`);
      setCount(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al cargar conteo'
      );
    }
  }, [countId]);

  const fetchItems = useCallback(
    async (p: number, discrepanciesOnly: boolean) => {
      setIsLoading(true);
      try {
        let url: string;
        if (discrepanciesOnly) {
          url = `/cycle-counts/${countId}/discrepancies?page=${p}&per_page=${PER_PAGE}`;
        } else {
          url = `/cycle-counts/${countId}?page=${p}&per_page=${PER_PAGE}`;
        }
        const res = await api.get<
          | { items: CycleCountItem[]; total: number }
          | CycleCountDetail & { items: CycleCountItem[] }
        >(url);

        if ('items' in res) {
          setItems(res.items ?? []);
          setTotal('total' in res ? (res as { total: number }).total : (res.items?.length ?? 0));
          if ('status' in res && 'name' in res) {
            setCount(res as CycleCountDetail);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error al cargar items'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [countId]
  );

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  useEffect(() => {
    fetchItems(page, showDiscrepanciesOnly);
  }, [page, showDiscrepanciesOnly, fetchItems]);

  const handleStart = async () => {
    try {
      await api.put(`/cycle-counts/${countId}/start`);
      toast.success('Conteo iniciado');
      fetchCount();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al iniciar conteo'
      );
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await api.post(`/cycle-counts/${countId}/apply`);
      toast.success('Ajustes aplicados correctamente');
      setShowApplyConfirm(false);
      fetchCount();
      fetchItems(page, showDiscrepanciesOnly);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al aplicar ajustes'
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await api.put(`/cycle-counts/${countId}/cancel`);
      toast.success('Conteo cancelado');
      setShowCancelConfirm(false);
      fetchCount();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cancelar conteo'
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Track recently saved items for green checkmark animation
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const handleInlineCount = async (itemId: string, value: string) => {
    if (!value || isNaN(Number(value))) return;
    setIsCounting(true);
    try {
      await api.post(`/cycle-counts/${countId}/items/${itemId}/count`, {
        counted_quantity: Number(value),
      });
      setSavedItemId(itemId);
      setTimeout(() => setSavedItemId(null), 1500);
      setEditingItemId(null);
      setEditQuantity('');
      fetchItems(page, showDiscrepanciesOnly);
      fetchCount();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al registrar conteo'
      );
    } finally {
      setIsCounting(false);
    }
  };

  const columns: ColumnDef<CycleCountItem>[] = [
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
      key: 'location',
      header: 'Ubicacion',
      render: (item) => item.location_name,
    },
    {
      key: 'system_quantity',
      header: 'Cantidad sistema',
      render: (item) => item.system_quantity,
    },
    {
      key: 'counted_quantity',
      header: 'Cantidad contada',
      render: (item) => {
        // Inline editable input for in_progress counts
        if (count?.status === 'in_progress' && item.counted_quantity === null) {
          return (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={editingItemId === item.id ? editQuantity : ''}
                onFocus={() => {
                  setEditingItemId(item.id);
                  setEditQuantity('');
                }}
                onChange={(e) => {
                  setEditingItemId(item.id);
                  setEditQuantity(e.target.value);
                }}
                onBlur={() => {
                  if (editingItemId === item.id && editQuantity) {
                    handleInlineCount(item.id, editQuantity);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editQuantity) {
                    handleInlineCount(item.id, editQuantity);
                  }
                }}
                className="w-24"
                data-testid="count-quantity-input"
              />
              {editingItemId === item.id && editQuantity && (
                <Button
                  size="sm"
                  onClick={() => handleInlineCount(item.id, editQuantity)}
                  disabled={isCounting}
                  data-testid="save-count-btn"
                >
                  {isCounting ? '...' : 'Guardar'}
                </Button>
              )}
            </div>
          );
        }
        if (item.counted_quantity !== null) {
          return (
            <div className="flex items-center gap-2">
              <span className="font-medium">{item.counted_quantity}</span>
              {savedItemId === item.id && (
                <span className="text-green-500 animate-pulse text-sm" data-testid="save-checkmark">&#10003;</span>
              )}
            </div>
          );
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item) => {
        if (item.counted_quantity === null) {
          return (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="item-status-badge">
              Pendiente
            </Badge>
          );
        }
        if (item.difference !== null && item.difference !== 0) {
          return (
            <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="item-status-badge">
              Diferencia: {item.difference > 0 ? `+${item.difference}` : item.difference}
            </Badge>
          );
        }
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="item-status-badge">
            Contado
          </Badge>
        );
      },
    },
    {
      key: 'difference',
      header: 'Diferencia',
      render: (item) => {
        if (item.difference === null || item.counted_quantity === null) {
          return <span className="text-muted-foreground">-</span>;
        }
        const diff = item.difference;
        if (diff === 0) {
          return <span className="text-green-600 font-medium">0</span>;
        }
        return (
          <span
            className={
              diff > 0
                ? 'text-blue-600 font-medium'
                : 'text-red-600 font-medium'
            }
            data-testid="count-difference"
          >
            {diff > 0 ? `+${diff}` : diff}
          </span>
        );
      },
    },
  ];

  if (error && !count) {
    return (
      <div className="space-y-6" data-testid="cycle-count-detail-page">
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button variant="outline" onClick={() => push('/conteos-ciclicos')}>
          Volver a conteos
        </Button>
      </div>
    );
  }

  if (!count) {
    return (
      <div className="space-y-6" data-testid="cycle-count-detail-page">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="cycle-count-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => push('/conteos-ciclicos')}
          >
            &larr; Volver
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold" data-testid="count-name">
                {count.name}
              </h1>
              <Badge className={STATUS_COLORS[count.status]} data-testid="count-status">
                {STATUS_LABELS[count.status]}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              {count.warehouse_name || count.warehouse_id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {count.status === 'draft' && (
            <Button onClick={handleStart} data-testid="start-count-btn">
              Iniciar conteo
            </Button>
          )}
          {count.status === 'in_progress' && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  setShowDiscrepanciesOnly((prev) => !prev)
                }
                data-testid="toggle-discrepancies-btn"
              >
                {showDiscrepanciesOnly
                  ? 'Ver todos'
                  : 'Ver diferencias'}
              </Button>
              <Button
                onClick={() => setShowApplyConfirm(true)}
                data-testid="apply-adjustments-btn"
              >
                Aplicar ajustes al inventario
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowCancelConfirm(true)}
                data-testid="cancel-count-detail-btn"
              >
                Cancelar conteo
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress indicator */}
      {count.summary && count.summary.total_items > 0 && (
        <div data-testid="count-progress">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">
              {count.summary.counted} de {count.summary.total_items} contados ({Math.round((count.summary.counted / count.summary.total_items) * 100)}%)
            </p>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${(count.summary.counted / count.summary.total_items) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary cards */}
      {count.summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard
            label="Total items"
            value={count.summary.total_items}
            testId="summary-total"
          />
          <SummaryCard
            label="Contados"
            value={count.summary.counted}
            testId="summary-counted"
          />
          <SummaryCard
            label="Pendientes"
            value={count.summary.pending}
            testId="summary-pending"
          />
          <SummaryCard
            label="Con diferencia"
            value={count.summary.with_discrepancy}
            testId="summary-discrepancy"
          />
        </div>
      )}

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Items table */}
      <DataTable
        columns={columns}
        data={items}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage={
          showDiscrepanciesOnly
            ? 'No hay diferencias encontradas'
            : 'No hay items en este conteo'
        }
        rowClassName={(item) =>
          item.counted_quantity === null
            ? 'opacity-60 bg-muted/30'
            : ''
        }
      />

      {/* Apply confirmation */}
      <ConfirmDialog
        open={showApplyConfirm}
        onOpenChange={setShowApplyConfirm}
        title="Aplicar ajustes al inventario"
        description="Esto ajustara las cantidades en el inventario segun los conteos registrados. Se aplicaran todos los ajustes de las diferencias encontradas. Esta accion no se puede deshacer."
        onConfirm={handleApply}
        isLoading={isApplying}
        confirmLabel="Aplicar ajustes al inventario"
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={showCancelConfirm}
        onOpenChange={setShowCancelConfirm}
        title="Cancelar conteo"
        description={`Se cancelara el conteo "${count.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleCancel}
        isLoading={isCancelling}
        confirmLabel="Cancelar conteo"
      />
    </div>
  );
}
