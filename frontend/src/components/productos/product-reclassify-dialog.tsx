/**
 * components/productos/product-reclassify-dialog.tsx — reclassify dialog
 * surfaced from the product detail page header.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-productos/spec` PROD-DETAIL-INV-3.
 *
 * Reads dialog state (`reclassifyOpen`, `reclassifyChoice`,
 * `reclassifyIsSaving`) from `useProductosScreenStore` (DETAIL slice). On
 * confirm calls `useProductActions().reclassifyProduct(id, choice)` which
 * invalidates `/products` + `/products/{id}` SWR caches. Calls
 * `refetchClassLock()` on success so the locked branch flips immediately.
 *
 * The `lockReason()` Spanish-string builder lives INLINE per design §7 R1
 * LOCKED DECISION — single consumer + tight UX coupling.
 */
'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProductActions } from '@/lib/hooks/use-product-actions';
import {
  PRODUCT_CLASS_LABELS,
  PRODUCT_CLASS_VALUES,
  type ClassLockStatus,
  type Product,
  type ProductClass,
} from '@/types';

/**
 * Build a Spanish lock-reason sentence mentioning only non-zero counts,
 * e.g. "Bloqueado por: 2 movimientos, 1 lote". Mirrors the legacy
 * `lockReason()` helper from the pre-refactor detail page verbatim.
 */
export function lockReason(lock: ClassLockStatus): string {
  const parts: string[] = [];
  if (lock.movements > 0) {
    parts.push(
      `${lock.movements} ${lock.movements === 1 ? 'movimiento' : 'movimientos'}`,
    );
  }
  if (lock.lots > 0) {
    parts.push(`${lock.lots} ${lock.lots === 1 ? 'lote' : 'lotes'}`);
  }
  if (lock.tool_instances > 0) {
    parts.push(
      `${lock.tool_instances} ${lock.tool_instances === 1 ? 'herramienta' : 'herramientas'}`,
    );
  }
  return parts.length > 0 ? `Bloqueado por: ${parts.join(', ')}` : 'Bloqueado';
}

interface ProductReclassifyDialogProps {
  product: Product;
  classLock: ClassLockStatus | null;
  refetchClassLock: () => Promise<unknown>;
}

export function ProductReclassifyDialog({
  product,
  classLock,
  refetchClassLock,
}: ProductReclassifyDialogProps) {
  const open = useProductosScreenStore((s) => s.reclassifyOpen);
  const choice = useProductosScreenStore((s) => s.reclassifyChoice);
  const isSaving = useProductosScreenStore((s) => s.reclassifyIsSaving);
  const closeDialog = useProductosScreenStore((s) => s.closeReclassifyDialog);
  const setChoice = useProductosScreenStore((s) => s.setReclassifyChoice);
  const setSaving = useProductosScreenStore((s) => s.setReclassifySaving);
  const { reclassifyProduct } = useProductActions();

  const isLocked = classLock?.locked ?? false;
  const confirmDisabled = isSaving || isLocked;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const updated = await reclassifyProduct(product.id, choice);
      closeDialog();
      toast.success(
        `Producto reclasificado a ${PRODUCT_CLASS_LABELS[updated.product_class]}`,
      );
      void refetchClassLock();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al reclasificar producto',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent data-testid="reclassify-dialog">
        <DialogHeader>
          <DialogTitle>Reclasificar producto</DialogTitle>
        </DialogHeader>
        {classLock?.locked ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Este producto ya tiene historial y no se puede reclasificar:
            </p>
            <p
              className="font-medium text-destructive"
              data-testid="reclassify-lock-reason"
            >
              {lockReason(classLock)}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecciona la nueva clase. Esta acción solo está disponible
              mientras el producto no tenga movimientos, lotes ni
              herramientas asociadas.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reclassify-class">Nueva clase</Label>
              <SearchableSelect
                value={choice}
                onValueChange={(val) => setChoice(val as ProductClass)}
                options={PRODUCT_CLASS_VALUES.map((value) => ({
                  value,
                  label: PRODUCT_CLASS_LABELS[value],
                }))}
                placeholder="Seleccionar clase"
                searchPlaceholder="Buscar clase..."
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeDialog}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            data-testid="reclassify-confirm-btn"
            data-locked={isLocked ? 'true' : 'false'}
          >
            {isSaving ? 'Reclasificando...' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
