/**
 * components/productos/product-detail-header.tsx — header block for the
 * product detail page (`/productos/[id]`).
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-DETAIL-INV-1.
 *
 * Pure presentational: receives the resolved `Product` + `classLock` via
 * props plus the open-dialog callback. URL navigation (`/productos`) goes
 * through `next/navigation` because the back button is rendered in the
 * header — keeping the click handler co-located mirrors the legacy page's
 * behavior. STRUCT-7 still holds: no `useSearchParams` reads here.
 */
'use client';

import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  PRODUCT_CLASS_BADGE_CLASSES,
  PRODUCT_CLASS_LABELS,
  type ClassLockStatus,
  type Product,
} from '@/types';

interface ProductDetailHeaderProps {
  product: Product;
  classLock: ClassLockStatus | null;
  isReclassifying: boolean;
  /** Spanish lock-reason sentence (only consulted when the lock is active). */
  lockTooltipText: string;
  onReclassifyOpen: () => void;
}

export function ProductDetailHeader({
  product,
  classLock,
  isReclassifying,
  lockTooltipText,
  onReclassifyOpen,
}: ProductDetailHeaderProps) {
  const { push } = useRouter();
  const isLocked = classLock?.locked ?? false;
  const reclassifyDisabled = isReclassifying || isLocked;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => push('/productos')}
        >
          Volver a productos
        </Button>
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <Badge
          variant="outline"
          className={cn(
            'border-0',
            PRODUCT_CLASS_BADGE_CLASSES[product.product_class],
          )}
          data-testid="product-class-badge"
          data-class={product.product_class}
        >
          {PRODUCT_CLASS_LABELS[product.product_class]}
        </Badge>
        {product.has_expiry && (
          <Badge
            variant="outline"
            className="border-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
            data-testid="product-has-expiry-chip"
          >
            Con caducidad
          </Badge>
        )}
        <Badge variant={product.is_active ? 'default' : 'secondary'}>
          {product.is_active ? 'Activo' : 'Inactivo'}
        </Badge>
        {isLocked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper keeps the tooltip working on a disabled
                  button (disabled buttons don't fire mouse events). */}
              <span
                tabIndex={0}
                data-testid="reclassify-btn-wrapper"
                className="inline-block"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  aria-disabled="true"
                  data-testid="reclassify-btn"
                  data-locked="true"
                >
                  Reclasificar
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-xs text-xs"
              data-testid="reclassify-lock-tooltip"
            >
              {lockTooltipText}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onReclassifyOpen}
            disabled={reclassifyDisabled}
            data-testid="reclassify-btn"
            data-locked="false"
          >
            Reclasificar
          </Button>
        )}
      </div>
    </div>
  );
}
