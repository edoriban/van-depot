/**
 * components/recetas/recipe-add-item-dialog.tsx — Agregar Material dialog
 * on the `/recetas/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §3 (SWR), §7 and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-3.
 *
 * Reads `addItemOpen` / `addItemDraft` / `localItems` from the screen store
 * and dispatches `setAddItemField`, `closeAddItemDialog`, `appendLocalItem`.
 *
 * Product fetch (design §4.4 LOCKED — inline conditional-key SWR):
 *   useSWR(addItemOpen ? '/products?per_page=100&page=1' : null)
 * Cache-key parity with the legacy one-shot `fetchProducts` call.
 *
 * On confirm:
 *   1. `recipeItemFormSchema.safeParse` validates productId + quantity.
 *   2. Locate `products.find(p => p.id === selectedProductId)`; if missing
 *      → no-op (preserves legacy guard).
 *   3. Check duplicate via `localItems.some(i => i.product_id === ...)`;
 *      if duplicate → toast `Este producto ya esta en la receta` and KEEP
 *      the dialog open (REC-DETAIL-INV-3 scenario).
 *   4. Otherwise dispatch `appendLocalItem({ id: temp-${Date.now()}, ... })`
 *      and close the dialog.
 */
'use client';

import { useMemo } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-mutations';
import { recipeItemFormSchema } from '@/features/recetas/schema';
import { useRecetasScreenStore } from '@/features/recetas/store';
import type { PaginatedResponse, Product, RecipeItem } from '@/types';

const PRODUCTS_KEY = '/products?per_page=100&page=1';

export function RecipeAddItemDialog() {
  const open = useRecetasScreenStore((s) => s.addItemOpen);
  const draft = useRecetasScreenStore((s) => s.addItemDraft);
  const localItems = useRecetasScreenStore((s) => s.localItems);
  const setField = useRecetasScreenStore((s) => s.setAddItemField);
  const closeDialog = useRecetasScreenStore((s) => s.closeAddItemDialog);
  const appendLocalItem = useRecetasScreenStore((s) => s.appendLocalItem);

  // Conditional-key SWR fetch — only fires when the dialog opens. Cache
  // persists across re-opens within the SWR provider's lifetime.
  const { data: productsResp, isLoading: productsLoading } = useSWR<
    PaginatedResponse<Product>
  >(open ? PRODUCTS_KEY : null, (k: string) =>
    api.get<PaginatedResponse<Product>>(k),
  );

  // Stable reference for the products array — re-uses the SWR-cached array
  // when present so `useMemo` below depends on a stable input. Empty array
  // literal is intentionally hoisted to module scope-equivalent via the
  // ?? fallback.
  const products = useMemo(
    () => productsResp?.data ?? [],
    [productsResp],
  );

  // Case-insensitive filter on name OR sku — preserves legacy L218-L222.
  const filteredProducts = useMemo(() => {
    const q = draft.productSearch.toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [products, draft.productSearch]);

  const handleConfirm = () => {
    const parsed = recipeItemFormSchema.safeParse({
      productId: draft.selectedProductId,
      quantity: draft.itemQuantity,
      notes: draft.itemNotes,
    });
    if (!parsed.success) {
      // Defensive — the Agregar button is gated by the same fields, so this
      // should be unreachable except for malformed quantity strings.
      return;
    }
    const product = products.find((p) => p.id === parsed.data.productId);
    if (!product) return;

    // Duplicate guard — keep dialog open + toast (REC-DETAIL-INV-3).
    const exists = localItems.some(
      (item) => item.product_id === parsed.data.productId,
    );
    if (exists) {
      toast.error('Este producto ya esta en la receta');
      return;
    }

    const newItem: RecipeItem = {
      id: `temp-${Date.now()}`,
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      unit_of_measure: product.unit_of_measure,
      quantity: parsed.data.quantity,
      notes: parsed.data.notes ?? null,
    };
    appendLocalItem(newItem);
    closeDialog();
    toast.success('Material agregado');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar Material</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Buscar producto</Label>
            <Input
              value={draft.productSearch}
              onChange={(e) => setField('productSearch', e.target.value)}
              placeholder="Buscar por nombre o SKU..."
            />
          </div>
          <div className="space-y-2">
            <Label>Producto</Label>
            {productsLoading ? (
              <div className="h-10 bg-muted rounded animate-pulse" />
            ) : (
              <Select
                value={draft.selectedProductId}
                onValueChange={(value) =>
                  setField('selectedProductId', value)
                }
              >
                <SelectTrigger
                  className="w-full"
                  data-testid="product-select"
                >
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {filteredProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-quantity">Cantidad</Label>
            <Input
              id="item-quantity"
              type="number"
              min="0.01"
              step="any"
              value={draft.itemQuantity}
              onChange={(e) => setField('itemQuantity', e.target.value)}
              placeholder="Cantidad requerida"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-notes">Notas (opcional)</Label>
            <Input
              id="item-notes"
              value={draft.itemNotes}
              onChange={(e) => setField('itemNotes', e.target.value)}
              placeholder="Notas adicionales"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!draft.selectedProductId || !draft.itemQuantity}
              data-testid="confirm-add-item-btn"
            >
              Agregar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
