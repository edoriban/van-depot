/**
 * components/form-field/form-field.tsx — label/control/error wrapper.
 *
 * See `frontend/src/CONVENTIONS.md` §4 (Reusable primitives catalog).
 */
import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  /** Human-readable label text. Rendered with `*` suffix when `required`. */
  label: string;
  /** Forwarded to `<Label htmlFor>`. Caller MUST set the inner control's `id` to match. */
  htmlFor: string;
  /** When non-empty, replaces `description` as the helper line and uses destructive tone. */
  error?: string;
  /** Optional helper line shown when `error` is empty. */
  description?: string;
  /** Appends `*` to the label when true. */
  required?: boolean;
  /** Forwarded to the wrapper `<div>`. */
  className?: string;
  /** The control (Input / Select / Textarea / SearchableSelect / etc.). */
  children: React.ReactNode;
}

/**
 * Thin presentational wrapper. Caller is responsible for:
 *   - matching `htmlFor` to the inner control's `id`,
 *   - deriving `error` from a Zod issue (e.g. `issues.find(i => i.path[0] === 'name')?.message`),
 *   - wiring value/onChange to the screen store or local useState.
 *
 * Renders nothing for `error` AND `description` when both are empty.
 *
 * @example
 *   <FormField label="Nombre" htmlFor="name" error={errors.name} required>
 *     <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
 *   </FormField>
 */
export function FormField({
  label,
  htmlFor,
  error,
  description,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const hasError = error !== undefined && error.trim() !== '';
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? ' *' : ''}
      </Label>
      {children}
      {hasError ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : description !== undefined && description !== '' ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
  );
}
