'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type { PurchaseReturnReason } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { toast } from 'sonner';

const REASON_LABELS: Record<PurchaseReturnReason, string> = {
  damaged: 'Dañado',
  defective: 'Defectuoso',
  wrong_product: 'Producto incorrecto',
  expired: 'Expirado',
  excess_inventory: 'Exceso de inventario',
  other: 'Otro',
};

interface POLine {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number;
}

export interface PurchaseReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: {
    id: string;
    order_number: string;
    lines: POLine[];
  };
  onSuccess: () => void;
}

export function PurchaseReturnDialog({
  open,
  onOpenChange,
  purchaseOrder,
  onSuccess,
}: PurchaseReturnDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<PurchaseReturnReason | ''>('');
  const [reasonNotes, setReasonNotes] = useState('');
  const [decreaseInventory, setDecreaseInventory] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const initial: Record<string, number> = {};
      purchaseOrder.lines.forEach((l) => {
        initial[l.id] = 0;
      });
      setQuantities(initial);
      setReason('');
      setReasonNotes('');
      setDecreaseInventory(true);
    }
  }, [open, purchaseOrder.lines]);

  const updateQty = (lineId: string, value: string) => {
    const num = parseInt(value, 10);
    setQuantities((prev) => ({ ...prev, [lineId]: isNaN(num) ? 0 : num }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!reason) {
      toast.error('Selecciona una razón de devolución');
      return;
    }

    const items = purchaseOrder.lines
      .filter((l) => (quantities[l.id] ?? 0) > 0)
      .map((l) => ({
        purchase_order_line_id: l.id,
        product_id: l.product_id,
        quantity_returned: quantities[l.id],
      }));

    if (items.length === 0) {
      toast.error('Agrega al menos un producto con cantidad a devolver');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/purchase-returns', {
        purchase_order_id: purchaseOrder.id,
        reason,
        reason_notes: reasonNotes || undefined,
        decrease_inventory: decreaseInventory,
        items,
      });
      toast.success('Devolución creada correctamente');
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear devolución');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalToReturn = purchaseOrder.lines.reduce((sum, l) => {
    const qty = quantities[l.id] ?? 0;
    return sum + qty * l.unit_price;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva devolución — Orden {purchaseOrder.order_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lines table */}
          <div className="space-y-2">
            <Label>Productos a devolver</Label>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Producto</th>
                    <th className="text-right px-3 py-2 font-medium">Recibido</th>
                    <th className="text-right px-3 py-2 font-medium">Precio unit.</th>
                    <th className="text-right px-3 py-2 font-medium w-32">Cant. devolver</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {purchaseOrder.lines.map((line) => (
                    <tr key={line.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium">{line.product_name ?? line.product_id.slice(0, 8)}</div>
                        {line.product_sku && (
                          <div className="text-xs text-muted-foreground">{line.product_sku}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {line.quantity_received}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        ${line.unit_price.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={line.quantity_received}
                          step={1}
                          value={quantities[line.id] ?? 0}
                          onChange={(e) => updateQty(line.id, e.target.value)}
                          className="text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end text-sm font-semibold">
              Total a devolver: ${totalToReturn.toFixed(2)}
            </div>
          </div>

          {/* Reason */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Razón de devolución</Label>
              <Select
                value={reason}
                onValueChange={(val) => setReason(val as PurchaseReturnReason)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar razón" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REASON_LABELS) as PurchaseReturnReason[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notas adicionales (opcional)</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={3}
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                placeholder="Detalles adicionales sobre la devolución"
              />
            </div>
          </div>

          {/* Inventory checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="decrease-inventory"
              checked={decreaseInventory}
              onChange={(e) => setDecreaseInventory(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="decrease-inventory" className="font-normal cursor-pointer">
              Descontar del inventario
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creando...' : 'Crear devolución'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
