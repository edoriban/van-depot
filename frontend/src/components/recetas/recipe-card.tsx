/**
 * components/recetas/recipe-card.tsx — single recipe card for the
 * `/recetas` LIST grid.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration pattern) and
 * `sdd/frontend-migration-recetas/spec` REC-LIST-INV-3.
 *
 * Preserves verbatim:
 *   - `recipe-card`, `recipe-detail-link`, `delete-recipe-btn` testids
 *   - `formatDateMediumEs` use + `suppressHydrationWarning`
 *   - singular/plural badge logic (`material` / `materiales`)
 *   - `Sin descripcion` fallback
 *   - `animate-fade-in-up` with stagger via `style={{ animationDelay }}`
 */
'use client';

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete01Icon } from '@hugeicons/core-free-icons';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateMediumEs } from '@/lib/format';
import type { Recipe } from '@/types';

interface RecipeCardProps {
  recipe: Recipe;
  /** 0-based index used to stagger the fade-in animation. */
  index: number;
  onDelete: (recipe: Recipe) => void;
}

export function RecipeCard({ recipe, index, onDelete }: RecipeCardProps) {
  const itemLabel = recipe.item_count === 1 ? 'material' : 'materiales';

  return (
    <Card
      className="animate-fade-in-up hover:border-primary/50 transition-colors"
      style={{ animationDelay: `${index * 50}ms` }}
      data-testid="recipe-card"
    >
      <CardHeader>
        <div className="flex flex-row items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg">{recipe.name}</CardTitle>
            <CardDescription className="line-clamp-2">
              {recipe.description || 'Sin descripcion'}
            </CardDescription>
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            <Badge variant="secondary">
              {recipe.item_count} {itemLabel}
            </Badge>
          </div>
        </div>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(recipe);
            }}
            data-testid="delete-recipe-btn"
          >
            <HugeiconsIcon icon={Delete01Icon} size={16} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span
            className="text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDateMediumEs(recipe.created_at)}
          </span>
          <Link
            href={`/recetas/${recipe.id}`}
            className="text-sm text-primary hover:underline"
            data-testid="recipe-detail-link"
          >
            Ver detalle →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
