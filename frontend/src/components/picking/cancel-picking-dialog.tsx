/**
 * components/picking/cancel-picking-dialog.tsx — cancel modal with optional reason.
 *
 * Reason is OPTIONAL: empty input passes `undefined` to `onSubmit`.
 * When entered, it MUST satisfy `cancelReasonSchema` (≥3 trimmed chars).
 * Inline validation error renders below the textarea; submit is always
 * clickable when the modal is open.
 *
 * Submit catches the error (already surfaced via the action hook) and keeps
 * the dialog open so the user can retry without losing context.
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cancelReasonSchema } from '@/features/picking/schema';

export interface CancelPickingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => Promise<void>;
}

export function CancelPickingDialog({
  isOpen,
  onClose,
  onSubmit,
}: CancelPickingDialogProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isSubmitting) return;
      if (!open) {
        setReason('');
        setError(null);
        onClose();
      }
    },
    [isSubmitting, onClose],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = reason.trim();
    let payload: string | undefined;

    if (trimmed.length === 0) {
      payload = undefined;
    } else {
      const parsed = cancelReasonSchema.safeParse(trimmed);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Motivo inválido');
        return;
      }
      payload = parsed.data;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(payload);
      setReason('');
      onClose();
    } catch {
      // Keep dialog open — action hook already toasted.
    } finally {
      setIsSubmitting(false);
    }
  }, [reason, onSubmit, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar lista de picking</DialogTitle>
          <DialogDescription>
            Esta acción cancela la lista. El motivo es opcional, pero se
            recomienda dejar constancia para futuras auditorías.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason" className="text-xs">
            Motivo (opcional)
          </Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Ej. Cliente canceló el pedido"
            rows={3}
            disabled={isSubmitting}
          />
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
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
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="confirm-cancel-picking"
          >
            {isSubmitting ? 'Cancelando…' : 'Cancelar lista'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
