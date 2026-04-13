'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  ProductLot,
  InventoryLot,
  LotMovement,
  QualityStatus,
  Location,
  PaginatedResponse,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';

// ── Quality status config ────────────────────────────────────────────

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
  quarantine:
    'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

// ── Movement type config ─────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
};

const MOVEMENT_COLORS: Record<string, string> = {
  entry: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  exit: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  transfer: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  adjustment:
    'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── KPI Card ─────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  description,
  children,
}: {
  title: string;
  value?: string | number;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        {children ?? <div className="text-2xl font-bold">{value}</div>}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function LotDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [lot, setLot] = useState<ProductLot | null>(null);
  const [inventory, setInventory] = useState<InventoryLot[]>([]);
  const [movements, setMovements] = useState<LotMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quality dialog
  const [qualityOpen, setQualityOpen] = useState(false);
  const [qualityStatus, setQualityStatus] = useState<QualityStatus>('pending');
  const [qualityNotes, setQualityNotes] = useState('');
  const [isQualitySubmitting, setIsQualitySubmitting] = useState(false);

  // Transfer dialog
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFromLocationId, setTransferFromLocationId] = useState('');
  const [transferFromLocationName, setTransferFromLocationName] = useState('');
  const [transferToLocationId, setTransferToLocationId] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferMaxQty, setTransferMaxQty] = useState(0);
  const [transferNotes, setTransferNotes] = useState('');
  const [isTransferSubmitting, setIsTransferSubmitting] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchLot = useCallback(async () => {
    try {
      const data = await api.get<ProductLot>(`/lots/${params.id}`);
      setLot(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al cargar el lote'
      );
    }
  }, [params.id]);

  const fetchInventory = useCallback(async () => {
    try {
      const data = await api.get<InventoryLot[]>(
        `/lots/${params.id}/inventory`
      );
      setInventory(data);
    } catch {
      // silent
    }
  }, [params.id]);

  const fetchMovements = useCallback(async () => {
    try {
      const data = await api.get<LotMovement[]>(
        `/lots/${params.id}/movements`
      );
      setMovements(data);
    } catch {
      // silent
    }
  }, [params.id]);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await Promise.allSettled([fetchLot(), fetchInventory(), fetchMovements()]);
    setIsLoading(false);
  }, [fetchLot, fetchInventory, fetchMovements]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Quality status change ──────────────────────────────────────────

  const openQualityDialog = () => {
    if (!lot) return;
    setQualityStatus(lot.quality_status);
    setQualityNotes('');
    setQualityOpen(true);
  };

  const handleQualitySubmit = async () => {
    setIsQualitySubmitting(true);
    try {
      await api.patch(`/lots/${params.id}/quality`, {
        quality_status: qualityStatus,
        notes: qualityNotes || undefined,
      });
      toast.success('Estado de calidad actualizado');
      setQualityOpen(false);
      await Promise.allSettled([fetchLot(), fetchMovements()]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al actualizar estado'
      );
    } finally {
      setIsQualitySubmitting(false);
    }
  };

  // ── Transfer ───────────────────────────────────────────────────────

  const fetchLocations = useCallback(async () => {
    try {
      // Get all warehouses, then fetch locations from each
      const warehouses = await api.get<{ id: string }[]>('/warehouses');
      const warehouseList = Array.isArray(warehouses) ? warehouses : [];

      const results = await Promise.allSettled(
        warehouseList.map((w) =>
          api.get<PaginatedResponse<Location>>(
            `/warehouses/${w.id}/locations?per_page=200&page=1`
          )
        )
      );

      const allLocations: Location[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const data = result.value;
          const locs = Array.isArray(data) ? data : data.data;
          allLocations.push(...locs);
        }
      }
      setLocations(allLocations);
    } catch {
      // silent - locations won't be available
    }
  }, []);

  const openTransferDialog = (inv: InventoryLot) => {
    setTransferFromLocationId(inv.location_id);
    setTransferFromLocationName(inv.location_name);
    setTransferToLocationId('');
    setTransferQty('');
    setTransferMaxQty(inv.quantity);
    setTransferNotes('');
    setTransferOpen(true);
    fetchLocations();
  };

  const handleTransferSubmit = async () => {
    if (!transferToLocationId || !transferQty) return;
    setIsTransferSubmitting(true);
    try {
      await api.post(`/lots/${params.id}/transfer`, {
        from_location_id: transferFromLocationId,
        to_location_id: transferToLocationId,
        quantity: Number(transferQty),
        notes: transferNotes || undefined,
      });
      toast.success('Transferencia realizada correctamente');
      setTransferOpen(false);
      await Promise.allSettled([fetchInventory(), fetchMovements()]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al transferir'
      );
    } finally {
      setIsTransferSubmitting(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────

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

  // ── Error state ────────────────────────────────────────────────────

  if (error || !lot) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push('/lotes')}>
          Volver a lotes
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? 'Lote no encontrado'}
        </div>
      </div>
    );
  }

  // ── KPI calculations ──────────────────────────────────────────────

  const totalInInventory = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const locationCount = inventory.length;

  return (
    <div className="space-y-6" data-testid="lot-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/lotes')}
          >
            &larr; Volver a lotes
          </Button>
          <h1 className="text-2xl font-bold font-mono">{lot.lot_number}</h1>
          <button
            type="button"
            onClick={openQualityDialog}
            className="cursor-pointer"
          >
            <Badge className={QUALITY_COLORS[lot.quality_status]}>
              {QUALITY_LABELS[lot.quality_status]}
            </Badge>
          </button>
        </div>
      </div>

      {/* Product info subtitle */}
      <p className="text-sm text-muted-foreground">
        Producto: <span className="font-mono">{lot.product_id.slice(0, 8)}...</span>
      </p>

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion del lote</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Producto:</span>{' '}
              <span className="font-medium font-mono">
                {lot.product_id.slice(0, 8)}...
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Fecha de lote:</span>{' '}
              <span className="font-medium">{formatDate(lot.batch_date)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Fecha de vencimiento:</span>{' '}
              <span className="font-medium">
                {formatDate(lot.expiration_date)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Proveedor:</span>{' '}
              <span className="font-medium">
                {lot.supplier_id ? (
                  <span className="font-mono">{lot.supplier_id.slice(0, 8)}...</span>
                ) : (
                  <span className="text-muted-foreground">Sin proveedor</span>
                )}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Cantidad recibida:</span>{' '}
              <span className="font-medium">{lot.received_quantity}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Notas:</span>{' '}
              <span className="font-medium">
                {lot.notes || (
                  <span className="text-muted-foreground">Sin notas</span>
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Total en inventario"
          value={totalInInventory}
        />
        <KpiCard
          title="Ubicaciones"
          value={locationCount}
          description={`${locationCount} ubicacion${locationCount !== 1 ? 'es' : ''}`}
        />
        <KpiCard title="Estado de calidad">
          <Badge className={QUALITY_COLORS[lot.quality_status]}>
            {QUALITY_LABELS[lot.quality_status]}
          </Badge>
        </KpiCard>
        <KpiCard
          title="Vencimiento"
          value={
            lot.expiration_date
              ? formatDate(lot.expiration_date)
              : 'Sin vencimiento'
          }
        />
      </div>

      {/* Inventory by location */}
      <Card>
        <CardHeader>
          <CardTitle>Inventario por ubicacion</CardTitle>
          <CardDescription>
            {locationCount} ubicacion{locationCount !== 1 ? 'es' : ''} con
            stock de este lote
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inventory.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No hay inventario registrado para este lote
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ubicacion</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.location_name}
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.quantity}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openTransferDialog(inv)}
                      >
                        Transferir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Movement history */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de movimientos</CardTitle>
          <CardDescription>
            {movements.length} movimiento{movements.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No hay movimientos registrados para este lote
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...movements]
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() -
                      new Date(a.created_at).getTime()
                  )
                  .map((mov) => (
                    <TableRow key={mov.id}>
                      <TableCell>
                        <Badge
                          className={
                            MOVEMENT_COLORS[mov.movement_type] ?? ''
                          }
                        >
                          {MOVEMENT_LABELS[mov.movement_type] ??
                            mov.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {mov.from_location_name || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {mov.to_location_name || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {mov.quantity}
                      </TableCell>
                      <TableCell>
                        {mov.reference || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatDateTime(mov.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quality status change dialog */}
      <Dialog open={qualityOpen} onOpenChange={setQualityOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar estado de calidad</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Estado actual:
              </p>
              <Badge className={QUALITY_COLORS[lot.quality_status]}>
                {QUALITY_LABELS[lot.quality_status]}
              </Badge>
            </div>
            <div className="space-y-2">
              <Label>Nuevo estado</Label>
              <Select
                value={qualityStatus}
                onValueChange={(v) => setQualityStatus(v as QualityStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="approved">Aprobado</SelectItem>
                  <SelectItem value="rejected">Rechazado</SelectItem>
                  <SelectItem value="quarantine">Cuarentena</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                rows={3}
                value={qualityNotes}
                onChange={(e) => setQualityNotes(e.target.value)}
                placeholder="Motivo del cambio de estado..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQualityOpen(false)}
              disabled={isQualitySubmitting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleQualitySubmit}
              disabled={isQualitySubmitting}
            >
              {isQualitySubmitting ? 'Guardando...' : 'Actualizar estado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir inventario de lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Origen</Label>
              <Input
                value={transferFromLocationName}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>Destino</Label>
              <SearchableSelect
                value={transferToLocationId || undefined}
                onValueChange={setTransferToLocationId}
                options={locations
                  .filter(
                    (l) =>
                      l.id !== transferFromLocationId && l.is_active
                  )
                  .map((l) => ({
                    value: l.id,
                    label: l.name,
                  }))}
                placeholder="Seleccionar ubicacion destino"
                searchPlaceholder="Buscar ubicacion..."
              />
            </div>
            <div className="space-y-2">
              <Label>
                Cantidad (max: {transferMaxQty})
              </Label>
              <Input
                type="number"
                min={0.01}
                max={transferMaxQty}
                step="any"
                value={transferQty}
                onChange={(e) => setTransferQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                rows={2}
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                placeholder="Notas de la transferencia..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={isTransferSubmitting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleTransferSubmit}
              disabled={
                isTransferSubmitting ||
                !transferToLocationId ||
                !transferQty ||
                Number(transferQty) <= 0 ||
                Number(transferQty) > transferMaxQty
              }
            >
              {isTransferSubmitting ? 'Transfiriendo...' : 'Transferir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
