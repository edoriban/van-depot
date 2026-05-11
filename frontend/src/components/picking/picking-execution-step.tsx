/**
 * components/picking/picking-execution-step.tsx — mobile linear execution step.
 *
 * Renders ONE current line at a time with:
 *   - Progress bar (picked + skipped / total).
 *   - Product header + requested-qty (read-only via `PickQuantityInput`).
 *   - Scanner CTA (delegated to caller via `onOpenScanner`; the page wires
 *     `<BarcodeScanner />` via dynamic-import per design §10).
 *   - Manual lot-number `<Input data-testid="manual-lot-input">` ALWAYS
 *     visible (locked decision #16 — Risk #1 mitigation for iOS Safari camera).
 *   - Pick + Skip CTAs (min-h-[44px] mobile tap targets).
 *   - When all lines reach picked/skipped → "Completar lista" CTA.
 *
 * State is local to the component (useState) per #540 deviation 2 — the
 * Zustand `usePickingExecutionStore` is intentionally deferred to E3.
 * Manual-lot input auto-resets when `currentLine.id` changes.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PickQuantityInput } from '@/components/picking/pick-quantity-input';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { BarCode02Icon } from '@hugeicons/core-free-icons';
import type { PickingLine, PickingListDetailResponse } from '@/types';

export interface PickingExecutionStepProps {
  list: PickingListDetailResponse;
  lines: PickingLine[];
  /** Lot id resolved upstream by a scanner-success callback (page-level). */
  scannedLotId?: string | null;
  onOpenScanner?: () => void;
  onPick: (lineId: string, lotId: string) => Promise<void> | void;
  onSkip: (lineId: string) => void;
  onComplete: () => Promise<void> | void;
  className?: string;
}

export function PickingExecutionStep({
  list,
  lines,
  scannedLotId,
  onOpenScanner,
  onPick,
  onSkip,
  onComplete,
  className,
}: PickingExecutionStepProps) {
  const counts = useMemo(() => {
    let picked = 0;
    let skipped = 0;
    for (const l of lines) {
      if (l.status === 'picked') picked += 1;
      else if (l.status === 'skipped') skipped += 1;
    }
    return { picked, skipped, total: lines.length };
  }, [lines]);

  const currentLine = useMemo(
    () => lines.find((l) => l.status === 'pending') ?? null,
    [lines],
  );

  const [manualLot, setManualLot] = useState('');
  const [isPicking, setIsPicking] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  // Reset transient inputs whenever the current line changes (auto-advance).
  useEffect(() => {
    setManualLot('');
  }, [currentLine?.id]);

  const effectiveLotId = scannedLotId || manualLot.trim();
  const canPick = Boolean(currentLine) && effectiveLotId.length > 0;

  const handlePick = useCallback(async () => {
    if (!currentLine || !effectiveLotId) return;
    setIsPicking(true);
    try {
      await onPick(currentLine.id, effectiveLotId);
    } catch {
      // Stay on the step — action hook already toasted.
    } finally {
      setIsPicking(false);
    }
  }, [currentLine, effectiveLotId, onPick]);

  const handleSkip = useCallback(() => {
    if (!currentLine) return;
    onSkip(currentLine.id);
  }, [currentLine, onSkip]);

  const handleComplete = useCallback(async () => {
    setIsCompleting(true);
    try {
      await onComplete();
    } catch {
      // Stay on the step — action hook already toasted.
    } finally {
      setIsCompleting(false);
    }
  }, [onComplete]);

  const progressPct =
    counts.total === 0
      ? 0
      : Math.round(((counts.picked + counts.skipped) / counts.total) * 100);

  const allDone = currentLine === null && counts.total > 0;
  const headerIndex = currentLine
    ? lines.findIndex((l) => l.id === currentLine.id) + 1
    : counts.total;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Progress */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {allDone
              ? 'Todas las líneas resueltas'
              : `Línea ${headerIndex} de ${counts.total}`}
          </span>
          <span>
            {counts.picked} recolectadas · {counts.skipped} omitidas
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {currentLine ? (
        <Card size="sm" className="gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                Lista {list.list.picking_number}
              </span>
              <span className="text-base font-medium text-foreground">
                {currentLine.product_name ??
                  currentLine.product_sku ??
                  currentLine.product_id}
              </span>
              {currentLine.product_sku &&
              currentLine.product_sku !==
                (currentLine.product_name ?? '') ? (
                <span className="text-xs text-muted-foreground">
                  SKU {currentLine.product_sku}
                </span>
              ) : null}
            </div>
            <StatusBadge variant="picking_line" value={currentLine.status} />
          </div>

          {currentLine.assigned_lot_id ? (
            <p className="text-xs text-muted-foreground">
              Lote sugerido (FEFO):{' '}
              <span className="font-mono">
                {currentLine.assigned_lot_id.slice(0, 12)}
              </span>
            </p>
          ) : null}

          <PickQuantityInput
            requestedQuantity={currentLine.requested_quantity}
          />

          <div className="flex flex-col gap-2">
            {onOpenScanner ? (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenScanner}
                className="min-h-[44px] justify-center"
                data-testid="open-scanner"
              >
                <HugeiconsIcon icon={BarCode02Icon} size={18} />
                <span>Escanear lote</span>
              </Button>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-lot" className="text-xs">
                O ingresa el número de lote
              </Label>
              <Input
                id="manual-lot"
                data-testid="manual-lot-input"
                value={manualLot}
                onChange={(e) => setManualLot(e.target.value)}
                placeholder="Ej. LOT-A1"
                disabled={isPicking}
              />
              {scannedLotId ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Lote escaneado:{' '}
                  <span className="font-mono">{scannedLotId.slice(0, 12)}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleSkip}
              disabled={isPicking}
              className="min-h-[44px]"
              data-testid="skip-current-line"
            >
              Omitir línea
            </Button>
            <Button
              type="button"
              onClick={handlePick}
              disabled={!canPick || isPicking}
              className="min-h-[44px]"
              data-testid="pick-current-line"
            >
              {isPicking ? 'Recolectando…' : 'Recolectar'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card size="sm" className="gap-3 p-5 text-center">
          <p className="font-medium text-foreground">
            Todas las líneas han sido procesadas
          </p>
          <p className="text-xs text-muted-foreground">
            Revisa el resumen y completa la lista para cerrarla.
          </p>
          <Button
            type="button"
            onClick={handleComplete}
            disabled={isCompleting || counts.total === 0}
            className="min-h-[44px] self-center"
            data-testid="complete-picking"
          >
            {isCompleting ? 'Completando…' : 'Completar lista'}
          </Button>
        </Card>
      )}
    </div>
  );
}
