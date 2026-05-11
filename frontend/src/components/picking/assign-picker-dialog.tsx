/**
 * components/picking/assign-picker-dialog.tsx — modal to assign an operator.
 *
 * Fetches operators via `useResourceList<Membership>('/memberships', { role: 'operator' })`
 * (Phase A backend endpoint, Owner|Manager-gated). Fetcher is gated by
 * passing `path=null` while the dialog is closed, so the request is only
 * issued on first open (#540 deviation 5).
 *
 * Operator label fallback chain: `user_name → user_email → user_id.slice(0,8)`.
 * Empty response surfaces a friendly "no operators" hint.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import type { Membership } from '@/types';

export interface AssignPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (userId: string) => Promise<void>;
  currentAssignedUserId?: string | null;
}

export function AssignPickerDialog({
  isOpen,
  onClose,
  onSubmit,
  currentAssignedUserId,
}: AssignPickerDialogProps) {
  // Defer the network call until the dialog is opened — `path=null` makes
  // `useResourceList` skip the fetch entirely.
  const { data: memberships, isLoading } = useResourceList<Membership>(
    isOpen ? '/memberships' : null,
    { role: 'operator' },
    { refreshInterval: 30_000 },
  );

  const [selectedUserId, setSelectedUserId] = useState<string>(
    currentAssignedUserId ?? '',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync the selection back to the prop when the dialog opens with a fresh
  // assignment (e.g., re-opens after the user changed the assignee elsewhere).
  useEffect(() => {
    if (isOpen) {
      setSelectedUserId(currentAssignedUserId ?? '');
    }
  }, [isOpen, currentAssignedUserId]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isSubmitting) return;
      if (!open) onClose();
    },
    [isSubmitting, onClose],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedUserId) return;
    setIsSubmitting(true);
    try {
      await onSubmit(selectedUserId);
      onClose();
    } catch {
      // Stay open — action hook already toasted.
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedUserId, onSubmit, onClose]);

  const options = useMemo(
    () => memberships ?? [],
    [memberships],
  );

  const hasOperators = options.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar operador</DialogTitle>
          <DialogDescription>
            Selecciona el operador que ejecutará esta lista de picking. Solo
            los miembros con rol Operador aparecen en el listado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-operator" className="text-xs">
            Operador
          </Label>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Cargando operadores…</p>
          ) : !hasOperators ? (
            <p className="text-xs text-muted-foreground">
              No hay operadores disponibles en este tenant.
            </p>
          ) : (
            <Select
              value={selectedUserId || undefined}
              onValueChange={setSelectedUserId}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="assign-operator"
                className="w-full"
                aria-label="Seleccionar operador"
              >
                <SelectValue placeholder="Selecciona un operador" />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {labelFor(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            disabled={isSubmitting || !selectedUserId}
            data-testid="confirm-assign-picker"
          >
            {isSubmitting ? 'Asignando…' : 'Asignar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function labelFor(m: Membership): string {
  if (m.user_name && m.user_name.trim() !== '') return m.user_name;
  if (m.user_email && m.user_email.trim() !== '') return m.user_email;
  return m.user_id.slice(0, 8);
}
