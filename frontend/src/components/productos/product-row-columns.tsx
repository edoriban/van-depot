/**
 * components/productos/product-row-columns.tsx — column builder for the
 * Productos tab data table.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1. Split out of `products-tab.tsx`
 * to honor the ≤270 LOC subcomponent budget (design §7 R8). All testids +
 * link copy + badge classes preserved verbatim per spec STRUCT-8.
 */
'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type ColumnDef } from '@/components/shared/data-table';
import { cn } from '@/lib/utils';
import {
  PRODUCT_CLASS_BADGE_CLASSES,
  PRODUCT_CLASS_LABELS_SHORT,
  type Category,
  type Product,
  type UnitType,
} from '@/types';

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

interface BuildColumnsOptions {
  categories: Category[];
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}

export function buildProductColumns({
  categories,
  onEdit,
  onDelete,
}: BuildColumnsOptions): ColumnDef<Product>[] {
  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return <span className="text-muted-foreground">-</span>;
    const cat = categories.find((c) => c.id === categoryId);
    return cat ? cat.name : <span className="text-muted-foreground">-</span>;
  };

  return [
    {
      key: 'name',
      header: 'Nombre',
      render: (p) => (
        <Link
          href={`/productos/${p.id}`}
          className="font-bold text-foreground hover:underline"
          data-testid="product-detail-link"
        >
          {p.name}
        </Link>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (p) => <span className="font-mono text-sm">{p.sku}</span>,
    },
    {
      key: 'class',
      header: 'Clase',
      render: (p) => (
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              'border-0',
              PRODUCT_CLASS_BADGE_CLASSES[p.product_class],
            )}
            data-testid="product-class-badge"
            data-class={p.product_class}
          >
            {PRODUCT_CLASS_LABELS_SHORT[p.product_class]}
          </Badge>
          {p.is_manufactured && (
            <Badge
              variant="outline"
              className="border-0 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
              data-testid="product-manufactured-badge"
              title="Este producto es el objetivo de una orden de trabajo"
            >
              MFG
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoria',
      render: (p) => getCategoryName(p.category_id),
    },
    {
      key: 'unit',
      header: 'Unidad de medida',
      render: (p) => UNIT_LABELS[p.unit_of_measure] ?? p.unit_of_measure,
    },
    {
      key: 'min_stock',
      header: 'Stock min',
      render: (p) => p.min_stock,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (p) => (
        <Badge variant={p.is_active ? 'default' : 'secondary'}>
          {p.is_active ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(p)}
            data-testid="edit-product-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onDelete(p)}
            data-testid="delete-product-btn"
          >
            Eliminar
          </Button>
        </div>
      ),
    },
  ];
}
