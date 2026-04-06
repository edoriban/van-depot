'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type { Location, Warehouse, PaginatedResponse, LocationType } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  zone: 'Zona',
  rack: 'Rack',
  shelf: 'Estante',
  position: 'Posicion',
  bin: 'Contenedor',
};

const LOCATION_TYPES: LocationType[] = ['zone', 'rack', 'shelf', 'position', 'bin'];

export default function UbicacionesPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formName, setFormName] = useState('');
  const [formLocationType, setFormLocationType] = useState<LocationType>('zone');
  const [formParentId, setFormParentId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // All locations for parent dropdown (from current warehouse)
  const [allLocationsForParent, setAllLocationsForParent] = useState<Location[]>([]);

  const perPage = 20;

  // Fetch warehouses on mount
  useEffect(() => {
    const fetchWarehouses = async () => {
      try {
        const res = await api.get<PaginatedResponse<Warehouse>>(
          '/warehouses?page=1&per_page=100'
        );
        setWarehouses(res.data);
        if (res.data.length > 0 && !selectedWarehouseId) {
          setSelectedWarehouseId(res.data[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar almacenes');
      }
    };
    fetchWarehouses();
  }, []);

  // Fetch locations when warehouse or page changes
  useEffect(() => {
    if (!selectedWarehouseId) {
      setLocations([]);
      setTotal(0);
      setIsLoading(false);
      return;
    }

    const fetchLocations = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get<PaginatedResponse<Location>>(
          `/warehouses/${selectedWarehouseId}/locations?page=${page}&per_page=${perPage}`
        );
        setLocations(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar ubicaciones');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLocations();
  }, [selectedWarehouseId, page]);

  // Fetch all locations for parent dropdown when warehouse changes
  useEffect(() => {
    if (!selectedWarehouseId) {
      setAllLocationsForParent([]);
      return;
    }
    const fetchAll = async () => {
      try {
        const res = await api.get<PaginatedResponse<Location>>(
          `/warehouses/${selectedWarehouseId}/locations?page=1&per_page=200`
        );
        setAllLocationsForParent(res.data);
      } catch {
        // Silently ignore - parent dropdown will just be empty
      }
    };
    fetchAll();
  }, [selectedWarehouseId]);

  const handleWarehouseChange = (warehouseId: string) => {
    setSelectedWarehouseId(warehouseId);
    setPage(1);
  };

  const openCreateDialog = () => {
    setEditingLocation(null);
    setFormName('');
    setFormLocationType('zone');
    setFormParentId('');
    setFormOpen(true);
  };

  const openEditDialog = (location: Location) => {
    setEditingLocation(location);
    setFormName(location.name);
    setFormLocationType(location.location_type);
    setFormParentId(location.parent_id ?? '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingLocation) {
        await api.put(`/locations/${editingLocation.id}`, {
          name: formName,
          location_type: formLocationType,
        });
      } else {
        await api.post(`/warehouses/${selectedWarehouseId}/locations`, {
          name: formName,
          location_type: formLocationType,
          parent_id: formParentId || undefined,
        });
      }
      setFormOpen(false);
      // Refresh both the table and parent list
      setPage(editingLocation ? page : 1);
      if (!editingLocation) setPage(1);
      // Trigger re-fetch
      const res = await api.get<PaginatedResponse<Location>>(
        `/warehouses/${selectedWarehouseId}/locations?page=${editingLocation ? page : 1}&per_page=${perPage}`
      );
      setLocations(res.data);
      setTotal(res.total);
      // Also refresh parent dropdown
      const allRes = await api.get<PaginatedResponse<Location>>(
        `/warehouses/${selectedWarehouseId}/locations?page=1&per_page=200`
      );
      setAllLocationsForParent(allRes.data);
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
      await api.del(`/locations/${deleteTarget.id}`);
      setDeleteTarget(null);
      // Refresh
      const res = await api.get<PaginatedResponse<Location>>(
        `/warehouses/${selectedWarehouseId}/locations?page=${page}&per_page=${perPage}`
      );
      setLocations(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  const getWarehouseName = (warehouseId: string) => {
    return warehouses.find((w) => w.id === warehouseId)?.name ?? '-';
  };

  const getParentName = (parentId?: string) => {
    if (!parentId) return <span className="text-muted-foreground">-</span>;
    const parent = allLocationsForParent.find((l) => l.id === parentId);
    return parent?.name ?? '-';
  };

  const columns: ColumnDef<Location>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (l) => <span className="font-medium">{l.name}</span>,
    },
    {
      key: 'type',
      header: 'Tipo',
      render: (l) => (
        <Badge variant="secondary">
          {LOCATION_TYPE_LABELS[l.location_type] ?? l.location_type}
        </Badge>
      ),
    },
    {
      key: 'warehouse',
      header: 'Almacen',
      render: (l) => getWarehouseName(l.warehouse_id),
    },
    {
      key: 'parent',
      header: 'Padre',
      render: (l) => getParentName(l.parent_id),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (l) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(l)}
            data-testid="edit-location-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleteTarget(l)}
            data-testid="delete-location-btn"
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
          <h1 className="text-2xl font-bold">Ubicaciones</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona las ubicaciones dentro de tus almacenes
          </p>
        </div>
        <Button
          onClick={openCreateDialog}
          disabled={!selectedWarehouseId}
          data-testid="new-location-btn"
        >
          Nueva ubicacion
        </Button>
      </div>

      {/* Warehouse selector */}
      <div className="flex items-center gap-3">
        <Label htmlFor="warehouse-filter">Almacen:</Label>
        <select
          id="warehouse-filter"
          value={selectedWarehouseId}
          onChange={(e) => handleWarehouseChange(e.target.value)}
          className="h-9 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
          data-testid="warehouse-selector"
        >
          {warehouses.length === 0 && (
            <option value="">Sin almacenes</option>
          )}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={locations}
        total={total}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay ubicaciones registradas"
      />

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingLocation ? 'Editar ubicacion' : 'Nueva ubicacion'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="location-name">Nombre</Label>
              <Input
                id="location-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre de la ubicacion"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-type">Tipo</Label>
              <select
                id="location-type"
                name="location_type"
                value={formLocationType}
                onChange={(e) => setFormLocationType(e.target.value as LocationType)}
                className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
                data-testid="location-type-select"
              >
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LOCATION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            {!editingLocation && (
              <div className="space-y-2">
                <Label htmlFor="location-parent">Ubicacion padre (opcional)</Label>
                <select
                  id="location-parent"
                  name="parent_id"
                  value={formParentId}
                  onChange={(e) => setFormParentId(e.target.value)}
                  className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
                  data-testid="location-parent-select"
                >
                  <option value="">Ninguna</option>
                  {allLocationsForParent.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({LOCATION_TYPE_LABELS[l.location_type]})
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                {isSaving ? 'Guardando...' : editingLocation ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar ubicacion"
        description={`Se eliminara la ubicacion "${deleteTarget?.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
