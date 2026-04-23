'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type { Warehouse, PaginatedResponse, CycleCountStatus } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { CheckListIcon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface CycleCount {
  id: string;
  warehouse_id: string;
  name: string;
  status: CycleCountStatus;
  notes?: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
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

export default function CycleCountsPage() {
  const router = useRouter();

  const [counts, setCounts] = useState<CycleCount[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterWarehouseId, setFilterWarehouseId] = useState('');

  // Reference data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formWarehouseId, setFormWarehouseId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Cancel dialog
  const [cancelTarget, setCancelTarget] = useState<CycleCount | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Fetch warehouses
  useEffect(() => {
    api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => {
        setWarehouses(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {});
  }, []);

  const fetchCounts = useCallback(
    async (p: number, status: string, warehouseId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(p),
          per_page: String(PER_PAGE),
        });
        if (status) params.set('status', status);
        if (warehouseId) params.set('warehouse_id', warehouseId);
        const res = await api.get<PaginatedResponse<CycleCount>>(
          `/cycle-counts?${params}`
        );
        setCounts(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error al cargar conteos'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCounts(page, filterStatus, filterWarehouseId);
  }, [page, filterStatus, filterWarehouseId, fetchCounts]);

  const getWarehouseName = (warehouseId: string) => {
    const wh = warehouses.find((w) => w.id === warehouseId);
    return wh ? wh.name : warehouseId;
  };

  const handleCreate = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const created = await api.post<CycleCount>('/cycle-counts', {
        warehouse_id: formWarehouseId,
        name: formName,
        notes: formNotes || undefined,
      });
      toast.success('Conteo creado correctamente');
      setCreateOpen(false);
      setFormName('');
      setFormWarehouseId('');
      setFormNotes('');
      router.push(`/conteos-ciclicos/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear conteo');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStart = async (count: CycleCount) => {
    try {
      await api.put(`/cycle-counts/${count.id}/start`);
      toast.success('Conteo iniciado');
      fetchCounts(page, filterStatus, filterWarehouseId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al iniciar conteo'
      );
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      await api.put(`/cycle-counts/${cancelTarget.id}/cancel`);
      toast.success('Conteo cancelado');
      setCancelTarget(null);
      fetchCounts(page, filterStatus, filterWarehouseId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cancelar conteo'
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const columns: ColumnDef<CycleCount>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'warehouse',
      header: 'Almacen',
      render: (c) => getWarehouseName(c.warehouse_id),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => (
        <Badge className={STATUS_COLORS[c.status]} data-testid="count-status-badge">
          {STATUS_LABELS[c.status]}
        </Badge>
      ),
    },
    {
      key: 'created_by',
      header: 'Creado por',
      render: (c) => c.created_by_name || c.created_by,
    },
    {
      key: 'date',
      header: 'Fecha',
      render: (c) =>
        new Date(c.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (c) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/conteos-ciclicos/${c.id}`)}
            data-testid="view-count-btn"
          >
            Ver
          </Button>
          {c.status === 'draft' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStart(c)}
              data-testid="start-count-btn"
            >
              Iniciar
            </Button>
          )}
          {(c.status === 'draft' || c.status === 'in_progress') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setCancelTarget(c)}
              data-testid="cancel-count-btn"
            >
              Cancelar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6" data-testid="cycle-counts-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conteos ciclicos</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los conteos de inventario fisico
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="new-count-btn">
          Nuevo conteo
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select
          value={filterStatus || 'all'}
          onValueChange={(val) => {
            setFilterStatus(val === 'all' ? '' : val);
            setPage(1);
          }}
        >
          <SelectTrigger data-testid="filter-status" className="w-48">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="draft">Borrador</SelectItem>
            <SelectItem value="in_progress">En progreso</SelectItem>
            <SelectItem value="completed">Completado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterWarehouseId || 'all'}
          onValueChange={(val) => {
            setFilterWarehouseId(val === 'all' ? '' : val);
            setPage(1);
          }}
        >
          <SelectTrigger data-testid="filter-warehouse" className="w-48">
            <SelectValue placeholder="Todos los almacenes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los almacenes</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={counts}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay conteos registrados"
        emptyState={
          <EmptyState
            icon={CheckListIcon}
            title="Aun no hay conteos"
            description="Crea tu primer conteo ciclico para verificar tu inventario."
            actionLabel="Nuevo conteo"
            onAction={() => setCreateOpen(true)}
          />
        }
      />

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo conteo ciclico</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="count-name">Nombre</Label>
              <Input
                id="count-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Conteo mensual enero"
                required
                data-testid="count-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="count-warehouse">Almacen</Label>
              <Select
                value={formWarehouseId || undefined}
                onValueChange={setFormWarehouseId}
              >
                <SelectTrigger data-testid="count-warehouse-select" className="w-full">
                  <SelectValue placeholder="Seleccionar almacen" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="count-notes">Notas (opcional)</Label>
              <Textarea
                id="count-notes"
                name="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Notas adicionales"
                rows={3}
                data-testid="count-notes-input"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="submit-count-btn">
                {isSaving ? 'Creando...' : 'Crear conteo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation */}
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancelar conteo"
        description={`Se cancelara el conteo "${cancelTarget?.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleCancel}
        isLoading={isCancelling}
        confirmLabel="Cancelar conteo"
      />
    </div>
  );
}
