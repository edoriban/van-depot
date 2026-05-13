/**
 * components/productos/product-form-fields.tsx — controlled-input field
 * block used INSIDE `<ProductCreateEditDialog>` (C8).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-productos/design` §7 R8 — the dialog file was
 * ~360 LOC, so the form fields are split out per the LOC budget rule
 * (mirrors the work-orders `work-order-create-form-fields.tsx` split).
 *
 * Reads its draft from the store via selectors passed by the parent so
 * this component stays purely presentational (no SWR, no mutations).
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { ProductCreateDraft } from '@/features/productos/store';
import { cn } from '@/lib/utils';
import {
  PRODUCT_CLASS_BADGE_CLASSES,
  PRODUCT_CLASS_LABELS,
  PRODUCT_CLASS_VALUES,
  type Category,
  type Product,
  type ProductClass,
  type UnitType,
} from '@/types';
import { ProductManufacturedToggle } from './product-manufactured-toggle';

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

interface ProductFormFieldsProps {
  draft: ProductCreateDraft;
  editingProduct: Product | null;
  categories: Category[];
  setField: <K extends keyof ProductCreateDraft>(
    key: K,
    value: ProductCreateDraft[K],
  ) => void;
}

export function ProductFormFields({
  draft,
  editingProduct,
  categories,
  setField,
}: ProductFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="product-name">Nombre</Label>
          <Input
            id="product-name"
            name="name"
            value={draft.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="Nombre del producto"
            required
            data-testid="product-name-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-sku">SKU</Label>
          <Input
            id="product-sku"
            name="sku"
            value={draft.sku}
            onChange={(e) => setField('sku', e.target.value)}
            placeholder="Codigo SKU"
            required
            data-testid="product-sku-input"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="product-description">Descripcion</Label>
        <Textarea
          id="product-description"
          name="description"
          value={draft.description}
          onChange={(e) => setField('description', e.target.value)}
          placeholder="Descripcion del producto (opcional)"
          rows={3}
          data-testid="product-description-input"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="product-category">Categoria</Label>
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
          <Label htmlFor="product-unit">Unidad de medida</Label>
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
          <Label htmlFor="product-class">Clase</Label>
          {editingProduct ? (
            <div
              className="flex h-9 items-center gap-2 rounded-3xl border border-dashed px-3 text-sm text-muted-foreground"
              data-testid="product-class-readonly"
            >
              <Badge
                variant="outline"
                className={cn(
                  'border-0',
                  PRODUCT_CLASS_BADGE_CLASSES[draft.productClass],
                )}
              >
                {PRODUCT_CLASS_LABELS[draft.productClass]}
              </Badge>
              <span className="text-xs">
                Usa &ldquo;Reclasificar&rdquo; en el detalle para cambiar la
                clase.
              </span>
            </div>
          ) : (
            <div data-testid="product-class-select-wrapper">
              <SearchableSelect
                value={draft.productClass}
                onValueChange={(val) =>
                  setField('productClass', val as ProductClass)
                }
                options={PRODUCT_CLASS_VALUES.map((value) => ({
                  value,
                  label: PRODUCT_CLASS_LABELS[value],
                }))}
                placeholder="Seleccionar clase"
                searchPlaceholder="Buscar clase..."
              />
            </div>
          )}
        </div>
        {draft.productClass !== 'tool_spare' ? (
          <div className="space-y-2">
            <Label htmlFor="product-has-expiry">Caducidad</Label>
            <div className="flex h-9 items-center gap-2">
              <input
                id="product-has-expiry"
                type="checkbox"
                checked={draft.hasExpiry}
                onChange={(e) => setField('hasExpiry', e.target.checked)}
                className="size-4 rounded border-input accent-primary"
                data-testid="product-has-expiry-toggle"
              />
              <label
                htmlFor="product-has-expiry"
                className="text-sm text-muted-foreground"
              >
                Este producto tiene fecha de caducidad
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-2" data-testid="product-has-expiry-hidden">
            <Label>Caducidad</Label>
            <div className="flex h-9 items-center text-sm text-muted-foreground">
              Las herramientas / refacciones no manejan caducidad.
            </div>
          </div>
        )}
      </div>
      <ProductManufacturedToggle
        productClass={draft.productClass}
        isManufactured={draft.isManufactured}
        manufacturedResetWarning={draft.manufacturedResetWarning}
        onChange={(next) => setField('isManufactured', next)}
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="product-min-stock">Stock minimo</Label>
          <Input
            id="product-min-stock"
            name="min_stock"
            type="number"
            min="0"
            value={draft.minStock}
            onChange={(e) => setField('minStock', e.target.value)}
            required
            data-testid="product-min-stock-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-max-stock">Stock maximo</Label>
          <Input
            id="product-max-stock"
            name="max_stock"
            type="number"
            min="0"
            value={draft.maxStock}
            onChange={(e) => setField('maxStock', e.target.value)}
            placeholder="Opcional"
            data-testid="product-max-stock-input"
          />
        </div>
      </div>
    </div>
  );
}
