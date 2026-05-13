/**
 * components/recetas/recipe-grid.tsx — grid container with skeleton,
 * empty-state, and recipe-card branches.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-LIST-INV-1 + REC-LIST-INV-3.
 *
 * Branch matrix:
 *   isLoading                       → 3 skeleton cards
 *   recipes.length === 0            → `<EmptyState>` (`Aun no tienes recetas`)
 *   otherwise                       → grid of `<RecipeCard>`
 *
 * Preserves the `recipe-grid` testid.
 */
'use client';

import { TaskDaily01Icon } from '@hugeicons/core-free-icons';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Recipe } from '@/types';
import { RecipeCard } from './recipe-card';

interface RecipeGridProps {
  recipes: Recipe[];
  isLoading: boolean;
  onCreate: () => void;
  onDelete: (recipe: Recipe) => void;
}

export function RecipeGrid({
  recipes,
  isLoading,
  onCreate,
  onDelete,
}: RecipeGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-5 skeleton-shimmer rounded w-2/3" />
              <div className="h-4 skeleton-shimmer rounded w-1/2 mt-2" />
            </CardHeader>
            <CardContent>
              <div className="h-4 skeleton-shimmer rounded w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <EmptyState
        icon={TaskDaily01Icon}
        title="Aun no tienes recetas"
        description="Crea tu primera receta de proyecto para definir los materiales que necesitas."
        actionLabel="Nueva Receta"
        onAction={onCreate}
      />
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="recipe-grid"
    >
      {recipes.map((recipe, i) => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
          index={i}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
