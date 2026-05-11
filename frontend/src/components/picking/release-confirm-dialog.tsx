/**
 * components/picking/release-confirm-dialog.tsx — confirm modal for /release.
 *
 * Renders a preview list of lines with each `assigned_lot_id` (or "sin
 * asignar" since the backend allocates DURING /release, so pre-release the
 * assigned lot is typically null).
 *
 * Confirm submits, on error keeps the dialog open (action hook toasted).
 */
'use client';

import { useCallback, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PickingLine } from '@/types';

export interface ReleaseConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  preview?: { lines: PickingLine[] };
}

export function ReleaseConfirmDialog({
  isOpen,
  onClose,
  onSubmit,
  preview,
}: ReleaseConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isSubmitting) return;
      if (!open) onClose();
    },
    [isSubmitting, onClose],
  );

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onSubmit();
      onClose();
    } catch {
      // Stay open — action hook already toasted.
    } finally {
      setIsSubmitting(false);
    }
  }, [onSubmit, onClose]);

  const lines = preview?.lines ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Liberar lista de picking</DialogTitle>
          <DialogDescription>
            Al liberar la lista, el sistema asignará lotes automáticamente
            mediante FEFO (caducidad más próxima primero). Revisa la previsualización antes de continuar.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'max-h-[260px] overflow-y-auto rounded-2xl border border-border/60',
            lines.length === 0 && 'flex items-center justify-center p-6',
          )}
        >
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay líneas para previsualizar.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {line.product_name ??
                        line.product_sku ??
                        line.product_id}
                    </span>
                    <span className="text-muted-foreground">
                      Cant. {line.requested_quantity}
                    </span>
                  </div>
                  <span className="font-mono text-[11px]">
                    {line.assigned_lot_id
                      ? `Lote ${line.assigned_lot_id.slice(0, 8)}`
                      : 'sin asignar'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Volver
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="confirm-release-picking"
          >
            {isSubmitting ? 'Liberando…' : 'Liberar lista'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
