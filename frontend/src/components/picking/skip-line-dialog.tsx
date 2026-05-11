/**
 * components/picking/skip-line-dialog.tsx — skip-line modal with required reason.
 *
 * Reason MUST satisfy `skipReasonSchema` (≥3 trimmed chars). Submit button
 * stays disabled until the reason is valid. Live char counter sits below the
 * textarea. Textarea autofocuses on open. Destructive variant on submit.
 *
 * No network call until validation passes (R8.1 / S8 / S24).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
import { skipReasonSchema } from '@/features/picking/schema';

const MAX_LEN = 500;

export interface SkipLineDialogProps {
  isOpen: boolean;
  onClose: () => void;
  lineId: string | null;
  onSubmit: (lineId: string, reason: string) => Promise<void>;
}

export function SkipLineDialog({
  isOpen,
  onClose,
  lineId,
  onSubmit,
}: SkipLineDialogProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
      // Defer autofocus to next paint so Radix has mounted the content.
      const t = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isSubmitting) return;
      if (!open) onClose();
    },
    [isSubmitting, onClose],
  );

  const trimmed = reason.trim();
  const parsed = skipReasonSchema.safeParse(trimmed);
  const isValid = parsed.success;

  const handleSubmit = useCallback(async () => {
    if (!lineId) return;
    const parsedNow = skipReasonSchema.safeParse(reason.trim());
    if (!parsedNow.success) {
      setError(parsedNow.error.issues[0]?.message ?? 'Motivo inválido');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(lineId, parsedNow.data);
      setReason('');
      onClose();
    } catch {
      // Stay open — action hook already toasted.
    } finally {
      setIsSubmitting(false);
    }
  }, [reason, lineId, onSubmit, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Omitir línea</DialogTitle>
          <DialogDescription>
            Indica el motivo por el cual se omitirá esta línea. El motivo
            queda registrado en la auditoría.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skip-reason" className="text-xs">
            Motivo (mínimo 3 caracteres)
          </Label>
          <Textarea
            id="skip-reason"
            ref={textareaRef}
            value={reason}
            onChange={(e) => {
              const next = e.target.value.slice(0, MAX_LEN);
              setReason(next);
              if (error) setError(null);
            }}
            placeholder="Ej. lote dañado, producto faltante…"
            rows={3}
            disabled={isSubmitting}
            aria-invalid={!isValid && trimmed.length > 0}
          />
          <div className="flex items-center justify-between text-xs">
            <span className={error ? 'text-destructive' : 'text-muted-foreground'}>
              {error ?? (isValid ? 'Motivo válido' : 'Pendiente')}
            </span>
            <span className="text-muted-foreground">
              {trimmed.length}/{MAX_LEN}
            </span>
          </div>
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
            disabled={isSubmitting || !isValid || !lineId}
            data-testid="confirm-skip-line"
          >
            {isSubmitting ? 'Omitiendo…' : 'Omitir línea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
