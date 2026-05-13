/**
 * components/work-orders/work-order-recipe-preview.tsx — BOM preview block
 * shown under the recipe select in the `Nueva orden` dialog.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Split out of `work-order-create-dialog.tsx` per design §R8 to keep that
 * file under the 270-LOC subcomponent ceiling. Receives the loaded recipe
 * detail as a prop and renders nothing when the recipe is null or has no
 * items — the dialog parent owns the load-by-id effect.
 */
'use client';

import type { RecipeDetail } from '@/types';

interface WorkOrderRecipePreviewProps {
  recipe: RecipeDetail | null;
}

export function WorkOrderRecipePreview({ recipe }: WorkOrderRecipePreviewProps) {
  if (!recipe || recipe.items.length === 0) {
    return null;
  }
  return (
    <div
      className="rounded-3xl border bg-muted/30 p-3"
      data-testid="recipe-preview"
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Ingredientes de la receta
      </p>
      <ul className="space-y-1 text-sm">
        {recipe.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between">
            <span>
              <span className="font-medium">{item.product_name}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {item.product_sku}
              </span>
            </span>
            <span className="text-muted-foreground">
              {item.quantity} {item.unit_of_measure}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
