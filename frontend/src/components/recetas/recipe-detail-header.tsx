/**
 * components/recetas/recipe-detail-header.tsx — header row for the
 * `/recetas/[id]` DETAIL page.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-DETAIL-INV-1 + REC-DETAIL-INV-2.
 *
 * Preserves:
 *   - `back-to-recipes` link (Link to `/recetas`).
 *   - `<h1>` with `recipe.name` + subtitle `description || 'Sin descripcion'`.
 *   - `edit-recipe-btn` invoking the parent-passed `onEdit` (page shell
 *     dispatches `openEditRecipeDialog(recipe)`).
 */
'use client';

import Link from 'next/link';
import {
  ArrowLeft01Icon,
  PencilEdit01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import type { Recipe } from '@/types';

interface RecipeDetailHeaderProps {
  recipe: Recipe;
  onEdit: () => void;
}

export function RecipeDetailHeader({
  recipe,
  onEdit,
}: RecipeDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/recetas" data-testid="back-to-recipes">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{recipe.name}</h1>
          <p className="text-muted-foreground">
            {recipe.description || 'Sin descripcion'}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={onEdit}
        data-testid="edit-recipe-btn"
      >
        <HugeiconsIcon icon={PencilEdit01Icon} size={16} className="mr-2" />
        Editar
      </Button>
    </div>
  );
}
