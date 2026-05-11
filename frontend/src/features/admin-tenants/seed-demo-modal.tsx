/**
 * features/admin-tenants/seed-demo-modal.tsx — D3 confirmation modal that
 * triggers `POST /admin/tenants/{id}/seed-demo` from the admin tenant detail
 * page. Names the tenant explicitly to prevent footguns; locks itself while
 * the request is in flight; surfaces 4xx/5xx inline so the user can retry.
 *
 * The "already-seeded" toast is the parent's responsibility — this modal only
 * forwards the `summary` envelope via `onSuccess`.
 */
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api-mutations';
import { seedDemoTenant } from '@/lib/api/tenants';
import type { SeedDemoSummary } from '@/lib/api/tenants';

export interface SeedDemoModalProps {
  open: boolean;
  tenant: { id: string; slug: string; name: string };
  onClose: () => void;
  onSuccess: (summary: SeedDemoSummary) => void;
}

export function SeedDemoModal({
  open,
  tenant,
  onClose,
  onSuccess,
}: SeedDemoModalProps) {
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function requestClose() {
    if (isSubmitting) return;
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await seedDemoTenant(tenant.id);
      onSuccess(res.summary);
      onClose();
    } catch (err) {
      if (isApiError(err) && err.message?.trim()) {
        setError(err.message);
      } else if (err instanceof Error && err.message?.trim()) {
        setError(err.message);
      } else {
        setError('No se pudieron cargar los datos demo. Intenta de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={!isSubmitting}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Cargar datos demo</DialogTitle>
          <DialogDescription>
            Esto agregara datos de muestra al inquilino{' '}
            <strong className="text-foreground">{tenant.name}</strong>{' '}
            (
            <code className="rounded bg-muted px-1 font-mono text-xs">
              {tenant.slug}
            </code>
            ). La operacion es idempotente: re-ejecutarla es seguro y solo
            agregara lo que falte. No existe accion para deshacer datos demo
            individualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Se agregaran (cuando no existan ya):</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Almacenes, ubicaciones y categorias base</li>
            <li>Proveedores y productos de ejemplo</li>
            <li>Una receta y dos ordenes de trabajo (borrador)</li>
            <li>Una orden de compra, un conteo ciclico y una notificacion</li>
            <li>Usuarios demo (carlos, miguel, laura) con membresias</li>
          </ul>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Cargar datos demo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
