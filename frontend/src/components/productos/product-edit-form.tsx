/**
 * components/productos/product-edit-form.tsx — inline edit form on the
 * product detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §1 (Zod), §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-DETAIL-INV-2.
 *
 * Reads `detailDraft` + `detailIsSaving` from `useProductosScreenStore`
 * (DETAIL slice) and writes via `setDetailFormField` / `setDetailSaving`.
 * On submit runs `productEditSchema.safeParse(...)` and dispatches the
 * `useProductActions().updateProduct(...)` mutation; success calls
 * `populateDetailDraft(updated)` to keep the form in sync after the
 * payload coercions on the wire (`tool_spare → hasExpiry=false`).
 *
 * Audit info card (Creado el / Actualizado el / by) is co-rendered inside
 * this component because it shares the `Product` prop and re-renders on
 * the same SWR data updates.
 */
'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { productEditSchema } from '@/features/productos/schema';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProductActions } from '@/lib/hooks/use-product-actions';
import type { Category, Product, UnitType } from '@/types';

const UNIT_LABELS: Record<UnitType, string> = {
  piece: 'Pieza',
  kg: 'Kilogramo',
  gram: 'Gramo',
  liter: 'Litro',
  ml: 'Mililitro',
  meter: 'Metro',
  cm: 'Centimetro',
  box: 'Caja',
  pack: 'Paquete',
};

interface ProductEditFormProps {
  product: Product;
  categories: Category[];
}

export function ProductEditForm({ product, categories }: ProductEditFormProps) {
  const draft = useProductosScreenStore((s) => s.detailDraft);
  const isSaving = useProductosScreenStore((s) => s.detailIsSaving);
  const setField = useProductosScreenStore((s) => s.setDetailFormField);
  const setSaving = useProductosScreenStore((s) => s.setDetailSaving);
  const populateDraft = useProductosScreenStore((s) => s.populateDetailDraft);
  const { updateProduct } = useProductActions();

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsed = productEditSchema.safeParse({
        name: draft.name,
        sku: draft.sku,
        description: draft.description,
        categoryId: draft.categoryId,
        unit: draft.unit,
        hasExpiry: draft.hasExpiry,
        minStock: draft.minStock,
        maxStock: draft.maxStock,
        isActive: draft.isActive,
      });
      if (!parsed.success) {
        toast.error('Revisa los campos del formulario');
        return;
      }
      const updated = await updateProduct(product.id, parsed.data);
      populateDraft(updated);
      toast.success('Producto actualizado correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informacion del producto</CardTitle>
        <CardDescription>
          Edita los campos y guarda los cambios.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="detail-name">Nombre</Label>
              <Input
                id="detail-name"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Nombre del producto"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-sku">SKU</Label>
              <Input
                id="detail-sku"
                value={draft.sku}
                onChange={(e) => setField('sku', e.target.value)}
                placeholder="Codigo SKU"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="detail-description">Descripcion</Label>
            <Textarea
              id="detail-description"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Descripcion del producto (opcional)"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="detail-category">Categoria</Label>
              <SearchableSelect
                value={draft.categoryId || 'none'}
                onValueChange={(val) =>
                  setField('categoryId', val === 'none' ? '' : val)
                }
                options={[
                  { value: 'none', label: 'Sin categoria' },
                  ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                ]}
                placeholder="Sin categoria"
                searchPlaceholder="Buscar categoria..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-unit">Unidad de medida</Label>
              <SearchableSelect
                value={draft.unit}
                onValueChange={(val) => setField('unit', val as UnitType)}
                options={(Object.entries(UNIT_LABELS) as [UnitType, string][]).map(
                  ([value, label]) => ({ value, label }),
                )}
                placeholder="Seleccionar unidad"
                searchPlaceholder="Buscar unidad..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="detail-min-stock">Stock minimo</Label>
              <Input
                id="detail-min-stock"
                type="number"
                min="0"
                value={draft.minStock}
                onChange={(e) => setField('minStock', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-max-stock">Stock maximo</Label>
              <Input
                id="detail-max-stock"
                type="number"
                min="0"
                value={draft.maxStock}
                onChange={(e) => setField('maxStock', e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          {/* has_expiry: hidden when class = tool_spare (invariant). */}
          {product.product_class !== 'tool_spare' ? (
            <div className="space-y-2">
              <Label htmlFor="detail-has-expiry">Caducidad</Label>
              <div className="flex h-9 items-center gap-2">
                <input
                  id="detail-has-expiry"
                  type="checkbox"
                  checked={draft.hasExpiry}
                  onChange={(e) => setField('hasExpiry', e.target.checked)}
                  className="size-4 rounded border-input accent-primary"
                  data-testid="detail-has-expiry-toggle"
                />
                <label
                  htmlFor="detail-has-expiry"
                  className="text-sm text-muted-foreground"
                >
                  Este producto tiene fecha de caducidad
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-2" data-testid="detail-has-expiry-hidden">
              <Label>Caducidad</Label>
              <div className="flex h-9 items-center text-sm text-muted-foreground">
                Las herramientas / refacciones no manejan caducidad.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="detail-status">Estado</Label>
            <Select
              value={draft.isActive ? 'active' : 'inactive'}
              onValueChange={(val) => setField('isActive', val === 'active')}
            >
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isSaving} data-testid="submit-btn">
              {isSaving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
