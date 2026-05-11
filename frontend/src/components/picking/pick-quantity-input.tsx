/**
 * components/picking/pick-quantity-input.tsx — read-only requested-quantity display.
 *
 * Renders a disabled `<Input type="number">` displaying the requested
 * quantity. Partial picks are out of scope (locked decision #6) so this
 * field is never user-editable; the disabled input keeps the visual rhythm
 * of the surrounding form and exposes the value to accessibility tools.
 */
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface PickQuantityInputProps {
  requestedQuantity: number;
  unit?: string;
  id?: string;
  description?: string;
  className?: string;
}

export function PickQuantityInput({
  requestedQuantity,
  unit,
  id = 'pick-qty',
  description = 'Las recolecciones parciales no están permitidas; la cantidad coincide con la solicitada.',
  className,
}: PickQuantityInputProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Cantidad a recolectar{unit ? ` (${unit})` : ''}
      </Label>
      <Input
        id={id}
        type="number"
        value={requestedQuantity}
        disabled
        readOnly
        aria-readonly
        className="font-mono tabular-nums"
      />
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
