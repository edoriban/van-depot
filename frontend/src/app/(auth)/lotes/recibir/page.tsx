'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type {
  Product,
  Supplier,
  Warehouse,
  Location,
  PaginatedResponse,
  ProductLot,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import Link from 'next/link';

export default function RecibirLotePage() {
  // Lookup data
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // Form state
  const [productId, setProductId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [goodQuantity, setGoodQuantity] = useState('');
  const [defectQuantity, setDefectQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [batchDate, setBatchDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Product[] | PaginatedResponse<Product>>('/products')
      .then((res) => setProducts(Array.isArray(res) ? res : res.data))
      .catch(() => {});
    api
      .get<Supplier[] | PaginatedResponse<Supplier>>('/suppliers')
      .then((res) => setSuppliers(Array.isArray(res) ? res : res.data))
      .catch(() => {});
    api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => setWarehouses(Array.isArray(res) ? res : res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }
    api
      .get<Location[] | PaginatedResponse<Location>>(
        `/warehouses/${warehouseId}/locations`
      )
      .then((res) => setLocations(Array.isArray(res) ? res : res.data))
      .catch(() => setLocations([]));
  }, [warehouseId]);

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
      // Reset form
      setProductId('');
      setLotNumber('');
      setWarehouseId('');
      setLocationId('');
      setGoodQuantity('');
      setDefectQuantity('');
      setSupplierId('');
      setBatchDate('');
      setExpirationDate('');
      setNotes('');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al recibir lote'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recibir Material</h1>
          <p className="text-muted-foreground mt-1">
            Registra la recepcion de material por lote
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/lotes">Ver lotes</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del lote</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Product and Lot Number */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Producto</Label>
                <Select
                  value={productId || undefined}
                  onValueChange={setProductId}
                >
                  <SelectTrigger data-testid="receive-product" className="w-full">
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Numero de lote</Label>
                <Input
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Ej: LOT-2026-001"
                  required
                  data-testid="receive-lot-number"
                />
              </div>
            </div>

            {/* Warehouse and Location */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Almacen</Label>
                <Select
                  value={warehouseId || undefined}
                  onValueChange={(val) => {
                    setWarehouseId(val);
                    setLocationId('');
                  }}
                >
                  <SelectTrigger data-testid="receive-warehouse" className="w-full">
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
                <Label>Ubicacion destino</Label>
                <Select
                  value={locationId || undefined}
                  onValueChange={setLocationId}
                  disabled={!warehouseId}
                >
                  <SelectTrigger data-testid="receive-location" className="w-full">
                    <SelectValue
                      placeholder={
                        warehouseId
                          ? 'Seleccionar ubicacion'
                          : 'Selecciona un almacen primero'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                        {l.label ? ` (${l.label})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quantities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cantidad buena</Label>
                <Input
                  type="number"
                  min={1}
                  step="any"
                  value={goodQuantity}
                  onChange={(e) => setGoodQuantity(e.target.value)}
                  required
                  placeholder="Cantidad en buen estado"
                  data-testid="receive-good-qty"
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
                  data-testid="receive-defect-qty"
                />
              </div>
            </div>

            {/* Supplier */}
            <div className="space-y-2">
              <Label>Proveedor (opcional)</Label>
              <Select
                value={supplierId || 'none'}
                onValueChange={(val) =>
                  setSupplierId(val === 'none' ? '' : val)
                }
              >
                <SelectTrigger data-testid="receive-supplier" className="w-full">
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proveedor</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de lote (opcional)</Label>
                <Input
                  type="date"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  data-testid="receive-batch-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha de vencimiento (opcional)</Label>
                <Input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  data-testid="receive-expiration-date"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones sobre la recepcion"
                rows={3}
                data-testid="receive-notes"
              />
            </div>

            <Button
              type="submit"
              disabled={saving || !productId || !lotNumber || !locationId || !goodQuantity}
              className="w-full"
              data-testid="receive-submit"
            >
              {saving ? 'Recibiendo...' : 'Recibir'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
