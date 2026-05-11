/**
 * components/picking/complete-confirm-dialog.tsx — summary confirm modal for /complete.
 *
 * Shows a 3-cell summary grid (picked / skipped / total) with tone-coded
 * counts; renders a defensive warning when `pending > 0` (per design §4.8,
 * the backend's 422 `incomplete_lines` will also surface a toast via the
 * action hook's codeMap).
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

export interface CompleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  summary?: {
    picked: number;
    skipped: number;
    total: number;
    pending?: number;
  };
}

export function CompleteConfirmDialog({
  isOpen,
  onClose,
  onSubmit,
  summary,
}: CompleteConfirmDialogProps) {
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

  const picked = summary?.picked ?? 0;
  const skipped = summary?.skipped ?? 0;
  const total = summary?.total ?? 0;
  const pending = summary?.pending ?? 0;
  const hasPending = pending > 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Completar lista</DialogTitle>
          <DialogDescription>
            Revisa el resumen antes de cerrar la lista. Una vez completada no
            podrá modificarse.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 text-center">
          <SummaryCell
            label="Recolectadas"
            value={picked}
            tone="text-emerald-700 dark:text-emerald-400"
          />
          <SummaryCell
            label="Omitidas"
            value={skipped}
            tone="text-orange-700 dark:text-orange-400"
          />
          <SummaryCell
            label="Total"
            value={total}
            tone="text-foreground"
          />
        </div>

        {hasPending ? (
          <p className="rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Aún hay {pending} línea(s) pendientes. El servidor rechazará la
            operación hasta que todas estén recolectadas u omitidas.
          </p>
        ) : null}

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
            disabled={isSubmitting || hasPending}
            data-testid="confirm-complete-picking"
          >
            {isSubmitting ? 'Completando…' : 'Completar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/40 px-3 py-3">
      <div className={cn('font-mono text-2xl font-semibold tabular-nums', tone)}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
