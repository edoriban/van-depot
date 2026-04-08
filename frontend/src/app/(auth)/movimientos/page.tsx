'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type {
  Movement,
  MovementType,
  MovementReason,
  Product,
  Warehouse,
  Location,
  Supplier,
  PaginatedResponse,
  PurchaseOrder,
  PurchaseOrderLine,
  ProductLot,
} from '@/types';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { toast } from 'sonner';

// --- Constants ---

const MOVEMENT_LABELS: Record<MovementType, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
};

const MOVEMENT_COLORS: Record<MovementType, string> = {
  entry: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  exit: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  transfer: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  adjustment: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const REASON_LABELS: Record<MovementReason, string> = {
  purchase_receive: 'Compra',
  purchase_return: 'Devolucion',
  quality_reject: 'Rechazo calidad',
  scrap: 'Desecho',
  loss_theft: 'Perdida/Robo',
  loss_damage: 'Perdida/Dano',
  production_input: 'Produccion (entrada)',
  production_output: 'Produccion (salida)',
  manual_adjustment: 'Ajuste manual',
  cycle_count: 'Conteo ciclico',
};

const REASON_COLORS: Record<MovementReason, string> = {
  purchase_receive: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  purchase_return: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  quality_reject: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  scrap: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  loss_theft: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  loss_damage: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  production_input: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  production_output: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  manual_adjustment: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  cycle_count: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

const PER_PAGE = 20;

// --- Helpers ---

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'hace un momento';
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays === 1) return 'ayer';
  if (diffDays < 7) return `hace ${diffDays} dias`;
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// --- Shared hooks ---

function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    api.get<Product[] | PaginatedResponse<Product>>('/products').then((res) => {
      setProducts(Array.isArray(res) ? res : res.data);
    }).catch(() => {});
  }, []);
  return products;
}

function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    api.get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses').then((res) => {
      setWarehouses(Array.isArray(res) ? res : res.data);
    }).catch(() => {});
  }, []);
  return warehouses;
}

function useLocations(warehouseId: string) {
  const [locations, setLocations] = useState<Location[]>([]);
  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }
    api.get<Location[] | PaginatedResponse<Location>>(`/warehouses/${warehouseId}/locations`).then((res) => {
      setLocations(Array.isArray(res) ? res : res.data);
    }).catch(() => setLocations([]));
  }, [warehouseId]);
  return locations;
}

function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  useEffect(() => {
    api.get<Supplier[] | PaginatedResponse<Supplier>>('/suppliers').then((res) => {
      setSuppliers(Array.isArray(res) ? res : res.data);
    }).catch(() => {});
  }, []);
  return suppliers;
}

// --- Warehouse + Location Selector ---

function WarehouseLocationSelector({
  warehouses,
  warehouseId,
  onWarehouseChange,
  locationId,
  onLocationChange,
  locations,
  excludeLocationId,
  label,
  locationTestId,
  warehouseTestId,
}: {
  warehouses: Warehouse[];
  warehouseId: string;
  onWarehouseChange: (id: string) => void;
  locationId: string;
  onLocationChange: (id: string) => void;
  locations: Location[];
  excludeLocationId?: string;
  label: string;
  locationTestId: string;
  warehouseTestId: string;
}) {
  const filteredLocations = excludeLocationId
    ? locations.filter(l => l.id !== excludeLocationId)
    : locations;
  return (
    <>
      <div className="space-y-2">
        <Label>Almacen</Label>
        <SearchableSelect
          value={warehouseId || undefined}
          onValueChange={(val) => {
            onWarehouseChange(val);
            onLocationChange('');
          }}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          placeholder="Seleccionar almacen"
          searchPlaceholder="Buscar almacen..."
        />
      </div>
      <div className="space-y-2">
        <Label>{label}</Label>
        <SearchableSelect
          value={locationId || undefined}
          onValueChange={onLocationChange}
          disabled={!warehouseId}
          options={filteredLocations.map((l) => ({ value: l.id, label: `${l.name}${l.label ? ` (${l.label})` : ''}` }))}
          placeholder={warehouseId ? "Seleccionar ubicacion" : "Selecciona un almacen primero"}
          searchPlaceholder="Buscar ubicacion..."
        />
      </div>
    </>
  );
}

// --- Entry Mode ---

type EntryMode = 'simple' | 'with_lot' | 'with_po';

function EntryModeSelector({
  mode,
  onChange,
}: {
  mode: EntryMode;
  onChange: (mode: EntryMode) => void;
}) {
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      <Button
        type="button"
        variant={mode === 'simple' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('simple')}
      >
        Entrada simple
      </Button>
      <Button
        type="button"
        variant={mode === 'with_lot' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('with_lot')}
      >
        Con lote
      </Button>
      <Button
        type="button"
        variant={mode === 'with_po' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('with_po')}
      >
        Con orden de compra
      </Button>
    </div>
  );
}

// --- Entry Simple Form (original EntryForm renamed) ---

function EntryForm({ products, warehouses, suppliers, onSuccess }: {
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const locations = useLocations(warehouseId);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/movements/entry', {
        product_id: productId,
        to_location_id: toLocationId,
        quantity: Number(quantity),
        supplier_id: supplierId || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success('Entrada registrada correctamente');
      setProductId('');
      setWarehouseId('');
      setToLocationId('');
      setQuantity('');
      setSupplierId('');
      setReference('');
      setNotes('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar entrada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="entry-form">
      <div className="space-y-2">
        <Label>Producto</Label>
        <SearchableSelect
          value={productId || undefined}
          onValueChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
          placeholder="Seleccionar producto"
          searchPlaceholder="Buscar producto..."
        />
      </div>

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={warehouseId}
        onWarehouseChange={setWarehouseId}
        locationId={toLocationId}
        onLocationChange={setToLocationId}
        locations={locations}
        label="Ubicacion destino"
        locationTestId="entry-to-location"
        warehouseTestId="entry-warehouse"
      />

      <div className="space-y-2">
        <Label>Cantidad</Label>
        <Input
          type="number"
          min={1}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
          placeholder="Cantidad"
          data-testid="entry-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Proveedor (opcional)</Label>
        <SearchableSelect
          value={supplierId || 'none'}
          onValueChange={(val) => setSupplierId(val === 'none' ? '' : val)}
          options={[
            { value: 'none', label: 'Sin proveedor' },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
          placeholder="Sin proveedor"
          searchPlaceholder="Buscar proveedor..."
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej: Factura #123" data-testid="entry-reference" />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales" data-testid="entry-notes" />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="entry-submit">
        {saving ? 'Registrando...' : 'Registrar entrada'}
      </Button>
    </form>
  );
}

// --- Entry With Lot Form ---

function EntryWithLotForm({ onSuccess }: { onSuccess: () => void }) {
  const products = useProducts();
  const warehouses = useWarehouses();
  const suppliers = useSuppliers();

  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [goodQuantity, setGoodQuantity] = useState('');
  const [defectQuantity, setDefectQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [batchDate, setBatchDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const locations = useLocations(warehouseId);

  const resetForm = () => {
    setProductId('');
    setWarehouseId('');
    setLocationId('');
    setLotNumber('');
    setGoodQuantity('');
    setDefectQuantity('');
    setSupplierId('');
    setBatchDate('');
    setExpirationDate('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const lot = await api.post<ProductLot>('/lots/receive', {
        product_id: productId,
        lot_number: lotNumber,
        location_id: locationId,
        good_quantity: Number(goodQuantity),
        defect_quantity: defectQuantity ? Number(defectQuantity) : undefined,
        supplier_id: supplierId || undefined,
        batch_date: batchDate || undefined,
        expiration_date: expirationDate || undefined,
        notes: notes || undefined,
      });
      toast.success(`Lote ${lot.lot_number} recibido correctamente`);
      resetForm();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al recibir lote');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="entry-lot-form">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Producto</Label>
          <SearchableSelect
            value={productId || undefined}
            onValueChange={setProductId}
            options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
            placeholder="Seleccionar producto"
            searchPlaceholder="Buscar producto..."
          />
        </div>
        <div className="space-y-2">
          <Label>Numero de lote</Label>
          <Input
            value={lotNumber}
            onChange={(e) => setLotNumber(e.target.value)}
            placeholder="Ej: LOT-2026-001"
            required
            data-testid="lot-number"
          />
        </div>
      </div>

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={warehouseId}
        onWarehouseChange={setWarehouseId}
        locationId={locationId}
        onLocationChange={setLocationId}
        locations={locations}
        label="Ubicacion destino"
        locationTestId="lot-location"
        warehouseTestId="lot-warehouse"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cantidad buena</Label>
          <Input
            type="number"
            min={0.01}
            step="any"
            value={goodQuantity}
            onChange={(e) => setGoodQuantity(e.target.value)}
            required
            placeholder="Cantidad en buen estado"
            data-testid="lot-good-qty"
          />
        </div>
        <div className="space-y-2">
          <Label>Cantidad defectuosa (opcional)</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={defectQuantity}
            onChange={(e) => setDefectQuantity(e.target.value)}
            placeholder="0"
            data-testid="lot-defect-qty"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Proveedor (opcional)</Label>
        <SearchableSelect
          value={supplierId || 'none'}
          onValueChange={(val) => setSupplierId(val === 'none' ? '' : val)}
          options={[
            { value: 'none', label: 'Sin proveedor' },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
          placeholder="Sin proveedor"
          searchPlaceholder="Buscar proveedor..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Fecha de lote (opcional)</Label>
          <Input
            type="date"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
            data-testid="lot-batch-date"
          />
        </div>
        <div className="space-y-2">
          <Label>Fecha de vencimiento (opcional)</Label>
          <Input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            data-testid="lot-expiration-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones sobre la recepcion"
          rows={3}
          data-testid="lot-notes"
        />
      </div>

      <Button
        type="submit"
        disabled={saving || !productId || !lotNumber || !locationId || !goodQuantity}
        className="w-full"
        data-testid="lot-submit"
      >
        {saving ? 'Recibiendo...' : 'Recibir lote'}
      </Button>
    </form>
  );
}

// --- Entry With PO Form ---

function EntryWithPOForm({ onSuccess }: { onSuccess: () => void }) {
  const warehouses = useWarehouses();

  // Step 1: PO search
  const [poSearch, setPoSearch] = useState('');
  const [poResults, setPoResults] = useState<PurchaseOrder[]>([]);
  const [isLoadingPOs, setIsLoadingPOs] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  // Step 2: Line selection
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState('');

  // Step 3: Receipt details
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [goodQuantity, setGoodQuantity] = useState('');
  const [defectQuantity, setDefectQuantity] = useState('');
  const [batchDate, setBatchDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const locations = useLocations(warehouseId);

  // Debounced PO search
  useEffect(() => {
    if (poSearch.length < 2) {
      setPoResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoadingPOs(true);
      try {
        const params = new URLSearchParams();
        params.set('order_number', poSearch);
        params.set('per_page', '10');
        const res = await api.get<PaginatedResponse<PurchaseOrder>>(
          `/purchase-orders?${params}`
        );
        setPoResults(res.data ?? []);
      } catch {
        setPoResults([]);
      } finally {
        setIsLoadingPOs(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [poSearch]);

  const handleSelectPO = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setPoSearch('');
    setPoResults([]);
    setSelectedLineId('');
    try {
      const lines = await api.get<PurchaseOrderLine[]>(
        `/purchase-orders/${po.id}/lines`
      );
      setPoLines(Array.isArray(lines) ? lines : []);
    } catch {
      toast.error('Error al cargar lineas de la orden');
      setPoLines([]);
    }
  };

  const resetStep2 = () => {
    setSelectedLineId('');
    setWarehouseId('');
    setLocationId('');
    setLotNumber('');
    setGoodQuantity('');
    setDefectQuantity('');
    setBatchDate('');
    setExpirationDate('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPO || !selectedLineId) return;
    const selectedLine = poLines.find((l) => l.id === selectedLineId);
    if (!selectedLine) return;

    setSaving(true);
    try {
      const lot = await api.post<ProductLot>('/lots/receive', {
        product_id: selectedLine.product_id,
        lot_number: lotNumber,
        location_id: locationId,
        good_quantity: Number(goodQuantity),
        defect_quantity: defectQuantity ? Number(defectQuantity) : undefined,
        supplier_id: selectedPO.supplier_id,
        batch_date: batchDate || undefined,
        expiration_date: expirationDate || undefined,
        notes: notes || undefined,
        purchase_order_line_id: selectedLineId,
        purchase_order_id: selectedPO.id,
      });
      toast.success(`Material recibido — OC ${selectedPO.order_number} actualizada (Lote: ${lot.lot_number})`);
      resetStep2();
      // Refresh PO lines
      const updatedLines = await api.get<PurchaseOrderLine[]>(
        `/purchase-orders/${selectedPO.id}/lines`
      );
      setPoLines(Array.isArray(updatedLines) ? updatedLines : []);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar recepcion');
    } finally {
      setSaving(false);
    }
  };

  const selectedLine = poLines.find((l) => l.id === selectedLineId);
  const pendingQty = selectedLine
    ? selectedLine.quantity_ordered - selectedLine.quantity_received
    : undefined;

  // Status labels
  const PO_STATUS_LABELS: Record<string, string> = {
    draft: 'Borrador',
    sent: 'Enviada',
    partially_received: 'Parcial',
    completed: 'Completada',
    cancelled: 'Cancelada',
  };

  return (
    <div className="space-y-4" data-testid="entry-po-form">
      {/* Step 1: Search PO */}
      {!selectedPO && (
        <div className="space-y-3">
          <Label>Buscar orden de compra</Label>
          <Input
            value={poSearch}
            onChange={(e) => setPoSearch(e.target.value)}
            placeholder="Escribe el numero de orden..."
            data-testid="po-search"
          />
          {isLoadingPOs && (
            <p className="text-sm text-muted-foreground">Buscando...</p>
          )}
          {poResults.length > 0 && (
            <div className="rounded-lg border divide-y">
              {poResults.map((po) => (
                <button
                  key={po.id}
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 text-left"
                  onClick={() => handleSelectPO(po)}
                >
                  <div>
                    <span className="font-mono font-medium">{po.order_number}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {po.supplier_name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {PO_STATUS_LABELS[po.status] ?? po.status}
                  </span>
                </button>
              ))}
            </div>
          )}
          {poSearch.length >= 2 && !isLoadingPOs && poResults.length === 0 && (
            <p className="text-sm text-muted-foreground">No se encontraron ordenes</p>
          )}
        </div>
      )}

      {/* Step 2 & 3: PO selected */}
      {selectedPO && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* PO Header */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono font-semibold">{selectedPO.order_number}</span>
                <span className="ml-2 text-sm text-muted-foreground">{selectedPO.supplier_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {PO_STATUS_LABELS[selectedPO.status] ?? selectedPO.status}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedPO(null);
                    setPoLines([]);
                    resetStep2();
                  }}
                >
                  Cambiar
                </Button>
              </div>
            </div>
          </div>

          {/* Step 2: Line selection */}
          {poLines.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta orden no tiene lineas o ya fue completada.
            </p>
          )}
          {poLines.length > 0 && (
            <div className="space-y-2">
              <Label>Selecciona la linea a recibir</Label>
              <div className="rounded-lg border divide-y">
                {poLines.map((line) => {
                  const pending = line.quantity_ordered - line.quantity_received;
                  const pct = line.quantity_ordered > 0
                    ? (line.quantity_received / line.quantity_ordered) * 100
                    : 0;
                  return (
                    <label
                      key={line.id}
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
                    >
                      <input
                        type="radio"
                        name="po-line"
                        value={line.id}
                        checked={selectedLineId === line.id}
                        onChange={() => setSelectedLineId(line.id)}
                        className="mt-1"
                        data-testid={`po-line-${line.id}`}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            {line.product_name ?? line.product_id.slice(0, 8) + '...'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Pendiente: {pending.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{line.quantity_received.toFixed(2)} / {line.quantity_ordered.toFixed(2)} recibido</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-green-500"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 3: Receipt details */}
          {selectedLineId && (
            <>
              <WarehouseLocationSelector
                warehouses={warehouses}
                warehouseId={warehouseId}
                onWarehouseChange={setWarehouseId}
                locationId={locationId}
                onLocationChange={setLocationId}
                locations={locations}
                label="Ubicacion destino"
                locationTestId="po-location"
                warehouseTestId="po-warehouse"
              />

              <div className="space-y-2">
                <Label>Numero de lote</Label>
                <Input
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Ej: LOT-2026-001"
                  required
                  data-testid="po-lot-number"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    Cantidad a recibir
                    {pendingQty !== undefined && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (max sugerido: {pendingQty.toFixed(2)})
                      </span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min={0.01}
                    max={pendingQty}
                    step="any"
                    value={goodQuantity}
                    onChange={(e) => setGoodQuantity(e.target.value)}
                    required
                    placeholder="Cantidad en buen estado"
                    data-testid="po-good-qty"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cantidad defectuosa (opcional)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={defectQuantity}
                    onChange={(e) => setDefectQuantity(e.target.value)}
                    placeholder="0"
                    data-testid="po-defect-qty"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha de lote (opcional)</Label>
                  <Input
                    type="date"
                    value={batchDate}
                    onChange={(e) => setBatchDate(e.target.value)}
                    data-testid="po-batch-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de vencimiento (opcional)</Label>
                  <Input
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    data-testid="po-expiration-date"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notas (opcional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observaciones sobre la recepcion"
                  rows={2}
                  data-testid="po-notes"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetStep2}
                >
                  Atras
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !locationId || !lotNumber || !goodQuantity}
                  className="flex-1"
                  data-testid="po-submit"
                >
                  {saving ? 'Registrando...' : 'Registrar recepcion'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}

// --- Exit Form ---

function ExitForm({ products, warehouses, onSuccess }: {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const locations = useLocations(warehouseId);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/movements/exit', {
        product_id: productId,
        from_location_id: fromLocationId,
        quantity: Number(quantity),
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success('Salida registrada correctamente');
      setProductId('');
      setWarehouseId('');
      setFromLocationId('');
      setQuantity('');
      setReference('');
      setNotes('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="exit-form">
      <div className="space-y-2">
        <Label>Producto</Label>
        <SearchableSelect
          value={productId || undefined}
          onValueChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
          placeholder="Seleccionar producto"
          searchPlaceholder="Buscar producto..."
        />
      </div>

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={warehouseId}
        onWarehouseChange={setWarehouseId}
        locationId={fromLocationId}
        onLocationChange={setFromLocationId}
        locations={locations}
        label="Ubicacion origen"
        locationTestId="exit-from-location"
        warehouseTestId="exit-warehouse"
      />

      <div className="space-y-2">
        <Label>Cantidad</Label>
        <Input
          type="number"
          min={1}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
          placeholder="Cantidad"
          data-testid="exit-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej: Orden de salida #456" data-testid="exit-reference" />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales" data-testid="exit-notes" />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="exit-submit">
        {saving ? 'Registrando...' : 'Registrar salida'}
      </Button>
    </form>
  );
}

// --- Transfer Form ---

function TransferForm({ products, warehouses, onSuccess }: {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const fromLocations = useLocations(fromWarehouseId);
  const toLocations = useLocations(toWarehouseId);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/movements/transfer', {
        product_id: productId,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        quantity: Number(quantity),
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success('Transferencia registrada correctamente');
      setProductId('');
      setFromWarehouseId('');
      setFromLocationId('');
      setToWarehouseId('');
      setToLocationId('');
      setQuantity('');
      setReference('');
      setNotes('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar transferencia');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="transfer-form">
      <div className="space-y-2">
        <Label>Producto</Label>
        <SearchableSelect
          value={productId || undefined}
          onValueChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
          placeholder="Seleccionar producto"
          searchPlaceholder="Buscar producto..."
        />
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
        <legend className="px-2 text-sm font-medium text-red-600 dark:text-red-400">Origen</legend>
        <WarehouseLocationSelector
          warehouses={warehouses}
          warehouseId={fromWarehouseId}
          onWarehouseChange={setFromWarehouseId}
          locationId={fromLocationId}
          onLocationChange={(id) => {
            setFromLocationId(id);
            if (id === toLocationId) setToLocationId('');
          }}
          locations={fromLocations}
          label="Ubicacion origen"
          locationTestId="transfer-from-location"
          warehouseTestId="transfer-from-warehouse"
        />
      </fieldset>

      <div className="flex items-center justify-center text-2xl text-muted-foreground">
        <span aria-hidden="true">&darr;</span>
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
        <legend className="px-2 text-sm font-medium text-green-600 dark:text-green-400">Destino</legend>
        <WarehouseLocationSelector
          warehouses={warehouses}
          warehouseId={toWarehouseId}
          onWarehouseChange={setToWarehouseId}
          locationId={toLocationId}
          onLocationChange={setToLocationId}
          locations={toLocations}
          excludeLocationId={fromLocationId}
          label="Ubicacion destino"
          locationTestId="transfer-to-location"
          warehouseTestId="transfer-to-warehouse"
        />
      </fieldset>

      <div className="space-y-2">
        <Label>Cantidad</Label>
        <Input
          type="number"
          min={1}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
          placeholder="Cantidad"
          data-testid="transfer-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej: Transferencia interna" data-testid="transfer-reference" />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales" data-testid="transfer-notes" />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="transfer-submit">
        {saving ? 'Registrando...' : 'Registrar transferencia'}
      </Button>
    </form>
  );
}

// --- Adjustment Form ---

function AdjustmentForm({ products, warehouses, onSuccess }: {
  products: Product[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const locations = useLocations(warehouseId);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/movements/adjustment', {
        product_id: productId,
        location_id: locationId,
        new_quantity: Number(newQuantity),
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success('Ajuste registrado correctamente');
      setProductId('');
      setWarehouseId('');
      setLocationId('');
      setNewQuantity('');
      setReference('');
      setNotes('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar ajuste');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="adjustment-form">
      <div className="space-y-2">
        <Label>Producto</Label>
        <SearchableSelect
          value={productId || undefined}
          onValueChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
          placeholder="Seleccionar producto"
          searchPlaceholder="Buscar producto..."
        />
      </div>

      <WarehouseLocationSelector
        warehouses={warehouses}
        warehouseId={warehouseId}
        onWarehouseChange={setWarehouseId}
        locationId={locationId}
        onLocationChange={setLocationId}
        locations={locations}
        label="Ubicacion"
        locationTestId="adjustment-location"
        warehouseTestId="adjustment-warehouse"
      />

      <div className="space-y-2">
        <Label>Nueva cantidad</Label>
        <Input
          type="number"
          min={0}
          step="any"
          value={newQuantity}
          onChange={(e) => setNewQuantity(e.target.value)}
          required
          placeholder="Nueva cantidad real"
          data-testid="adjustment-quantity"
        />
      </div>

      <div className="space-y-2">
        <Label>Referencia (opcional)</Label>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej: Conteo fisico" data-testid="adjustment-reference" />
      </div>

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales" data-testid="adjustment-notes" />
      </div>

      <Button type="submit" disabled={saving} className="w-full" data-testid="adjustment-submit">
        {saving ? 'Registrando...' : 'Registrar ajuste'}
      </Button>
    </form>
  );
}

// --- Entry Tab Content (mode selector + sub-forms) ---

function EntryTabContent({
  products,
  warehouses,
  suppliers,
  onSuccess,
}: {
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onSuccess: () => void;
}) {
  const [entryMode, setEntryMode] = useState<EntryMode>('simple');

  return (
    <>
      <EntryModeSelector mode={entryMode} onChange={setEntryMode} />
      {entryMode === 'simple' && (
        <EntryForm
          products={products}
          warehouses={warehouses}
          suppliers={suppliers}
          onSuccess={onSuccess}
        />
      )}
      {entryMode === 'with_lot' && (
        <EntryWithLotForm onSuccess={onSuccess} />
      )}
      {entryMode === 'with_po' && (
        <EntryWithPOForm onSuccess={onSuccess} />
      )}
    </>
  );
}

// --- Movement History with expanded product/location info ---

interface MovementWithDetails extends Movement {
  product_name?: string;
  product_sku?: string;
  from_location_name?: string;
  to_location_name?: string;
}

// --- Main Page ---

export default function MovementsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') || 'entry';

  const handleTabChange = (value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', value);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const products = useProducts();
  const warehouses = useWarehouses();
  const suppliers = useSuppliers();

  // History state
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [highlightNew, setHighlightNew] = useState(false);

  const fetchMovements = useCallback(async (p: number, typeFilter: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) });
      if (typeFilter) params.set('movement_type', typeFilter);
      const res = await api.get<PaginatedResponse<MovementWithDetails>>(`/movements?${params}`);
      setMovements(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Error al cargar historial de movimientos');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovements(page, filterType);
  }, [page, filterType, fetchMovements]);

  const handleSuccess = () => {
    setPage(1);
    setHighlightNew(true);
    fetchMovements(1, filterType);
    setTimeout(() => setHighlightNew(false), 2000);
  };

  // Build product/location lookup maps for display
  const productMap = new Map(products.map((p) => [p.id, p]));

  const getProductDisplay = (m: MovementWithDetails) => {
    if (m.product_name) return `${m.product_name} (${m.product_sku ?? ''})`;
    const p = productMap.get(m.product_id);
    return p ? `${p.name} (${p.sku})` : m.product_id;
  };

  const getOriginDisplay = (m: MovementWithDetails) => {
    if (m.from_location_name) return m.from_location_name;
    return m.from_location_id ? m.from_location_id.slice(0, 8) + '...' : '-';
  };

  const getDestDisplay = (m: MovementWithDetails) => {
    if (m.to_location_name) return m.to_location_name;
    return m.to_location_id ? m.to_location_id.slice(0, 8) + '...' : '-';
  };

  const columns: ColumnDef<MovementWithDetails>[] = [
    {
      key: 'type',
      header: 'Tipo',
      render: (m) => (
        <Badge className={MOVEMENT_COLORS[m.movement_type]} data-testid="movement-type-badge">
          {MOVEMENT_LABELS[m.movement_type]}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Razon',
      render: (m) =>
        m.movement_reason ? (
          <Badge className={REASON_COLORS[m.movement_reason]} data-testid="movement-reason-badge">
            {REASON_LABELS[m.movement_reason]}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'product',
      header: 'Producto',
      render: (m) => <span className="font-medium">{getProductDisplay(m)}</span>,
    },
    {
      key: 'locations',
      header: 'Origen → Destino',
      render: (m) => (
        <span>
          {getOriginDisplay(m)} → {getDestDisplay(m)}
        </span>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (m) => m.quantity,
    },
    {
      key: 'reference',
      header: 'Referencia',
      render: (m) => m.reference || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'date',
      header: 'Fecha',
      render: (m) => (
        <span title={new Date(m.created_at).toLocaleString('es-MX')}>
          {relativeDate(m.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8" data-testid="movements-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Movimientos</h1>
        <p className="text-muted-foreground mt-1">
          Registra entradas, salidas, transferencias y ajustes de inventario
        </p>
      </div>

      {/* Section 1: Movement Actions */}
      <Card className="p-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} data-testid="movement-tabs">
          <TabsList data-testid="movement-tabs-list">
            <TabsTrigger value="entry" data-testid="tab-entry">Entrada</TabsTrigger>
            <TabsTrigger value="exit" data-testid="tab-exit">Salida</TabsTrigger>
            <TabsTrigger value="transfer" data-testid="tab-transfer">Transferencia</TabsTrigger>
            <TabsTrigger value="adjustment" data-testid="tab-adjustment">Ajuste</TabsTrigger>
          </TabsList>

          <TabsContent value="entry" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">Registra material que llega al almacen</p>
            <EntryTabContent
              products={products}
              warehouses={warehouses}
              suppliers={suppliers}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="exit" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">Registra material que sale del almacen</p>
            <ExitForm
              products={products}
              warehouses={warehouses}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="transfer" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">Mueve material entre ubicaciones</p>
            <TransferForm
              products={products}
              warehouses={warehouses}
              onSuccess={handleSuccess}
            />
          </TabsContent>

          <TabsContent value="adjustment" className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">Corrige cantidades despues de un conteo fisico</p>
            <AdjustmentForm
              products={products}
              warehouses={warehouses}
              onSuccess={handleSuccess}
            />
          </TabsContent>
        </Tabs>
      </Card>

      {/* Section 2: Movement History */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Historial de movimientos</h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="filter-type" className="text-sm whitespace-nowrap">Filtrar por tipo:</Label>
            <Select
              value={filterType || 'all'}
              onValueChange={(val) => {
                setFilterType(val === 'all' ? '' : val);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="filter-movement-type" className="w-48">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="entry">Entrada</SelectItem>
                <SelectItem value="exit">Salida</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
                <SelectItem value="adjustment">Ajuste</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={movements}
          total={total}
          page={page}
          perPage={PER_PAGE}
          onPageChange={setPage}
          isLoading={isLoading}
          rowClassName={(_item, index) =>
            index === 0 && highlightNew
              ? 'animate-[highlight-row_2s_ease-out]'
              : ''
          }
          emptyMessage="No hay movimientos registrados"
          emptyState={
            <EmptyState
              icon={ArrowDataTransferHorizontalIcon}
              title="Aun no hay movimientos registrados"
              description="Registra tu primera entrada de material usando el formulario de arriba."
            />
          }
        />
      </div>
    </div>
  );
}
