/**
 * app/(auth)/productos/[id]/page.tsx — thin orchestration shell for the
 * product DETAIL screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR), §7.1 (Migration
 * pattern) and `sdd/frontend-migration-productos/design` §2.2 + §4.
 *
 * Owns:
 *   - `id` route param resolution via `useParams`.
 *   - The detail SWR fetch (`useProduct`) + categories (`useCategories`)
 *     + non-blocking class-lock probe (`useProductClassLock`).
 *   - Composition of the detail subcomponents under `components/productos/`.
 *   - The `populateDetailDraft` effect that pre-fills the edit form from
 *     the SWR result (replaces the legacy imperative `populateForm()`).
 *
 * Detail-slice cleanup mounted via FS-2.2 — list slice survives so the
 * back navigation preserves the list page's URL filters and dialog state.
 */
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProductDetailHeader } from '@/components/productos/product-detail-header';
import { ProductEditForm } from '@/components/productos/product-edit-form';
import { ProductMovementHistory } from '@/components/productos/product-movement-history';
import {
  ProductReclassifyDialog,
  lockReason,
} from '@/components/productos/product-reclassify-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductosScreenStore } from '@/features/productos/store';
import { useCategories } from '@/lib/hooks/use-categories';
import { useProduct } from '@/lib/hooks/use-product';
import { useProductClassLock } from '@/lib/hooks/use-product-class-lock';

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useRouter();
  const id = params.id;

  // FS-2.2 — reset the detail slice when the page unmounts.
  useEffect(
    () => () => useProductosScreenStore.getState().resetDetail(),
    [],
  );

  const { data: product, isLoading, error } = useProduct(id);
  const { data: categories } = useCategories();
  const { lock: classLock, refetch: refetchClassLock } = useProductClassLock(id);

  const populateDetailDraft = useProductosScreenStore(
    (s) => s.populateDetailDraft,
  );
  const isReclassifying = useProductosScreenStore((s) => s.reclassifyIsSaving);
  const openReclassifyDialog = useProductosScreenStore(
    (s) => s.openReclassifyDialog,
  );

  // Sync the edit-form draft from the SWR result. ONE Zustand set() — no
  // cascade. Re-runs whenever the underlying product changes (e.g. after a
  // successful reclassify revalidates the cache).
  useEffect(() => {
    if (product) {
      populateDetailDraft(product);
    }
  }, [product, populateDetailDraft]);

  if (isLoading && !product) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !product) {
    const message =
      error instanceof Error ? error.message : 'Producto no encontrado';
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => push('/productos')}>
          Volver a productos
        </Button>
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {message}
        </div>
      </div>
    );
  }

  const tooltipText =
    classLock && classLock.locked ? lockReason(classLock) : '';

  return (
    <div className="space-y-6" data-testid="product-detail-page">
      <ProductDetailHeader
        product={product}
        classLock={classLock}
        isReclassifying={isReclassifying}
        lockTooltipText={tooltipText}
        onReclassifyOpen={() => {
          openReclassifyDialog(product.product_class);
          void refetchClassLock();
        }}
      />

      <ProductEditForm product={product} categories={categories} />

      <Card>
        <CardHeader>
          <CardTitle>Informacion de auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Creado el:</span>{' '}
              <span className="font-medium">
                {formatDateLong(product.created_at)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Actualizado el:</span>{' '}
              <span className="font-medium">
                {formatDateLong(product.updated_at)}
              </span>
            </div>
            {product.created_by_email && (
              <div>
                <span className="text-muted-foreground">Creado por:</span>{' '}
                <span className="font-medium">{product.created_by_email}</span>
              </div>
            )}
            {product.updated_by_email && (
              <div>
                <span className="text-muted-foreground">
                  Ultima modificacion por:
                </span>{' '}
                <span className="font-medium">{product.updated_by_email}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ProductMovementHistory productId={id} />

      <ProductReclassifyDialog
        product={product}
        classLock={classLock}
        refetchClassLock={refetchClassLock}
      />
    </div>
  );
}
