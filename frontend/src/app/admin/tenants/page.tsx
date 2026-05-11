/**
 * /admin/tenants — superadmin tenant directory (A19 list view).
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/form-field';
import { toast } from 'sonner';
import { Loader2, Plus, ChevronRight } from 'lucide-react';
import {
  createTenant,
  tenantsKey,
} from '@/lib/api/tenants';
import { createTenantSchema } from '@/features/admin-tenants/schema';
import { surfaceApiError } from '@/lib/api';
import type { Tenant } from '@/types';

export default function AdminTenantsPage() {
  const [includeSuspended, setIncludeSuspended] = useState(false);
  const {
    data: tenants,
    isLoading,
    error,
    refresh,
  } = useResourceList<Tenant>(tenantsKey(includeSuspended));

  const [isCreateOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inquilinos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lista de organizaciones registradas en VanFlux.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={includeSuspended}
              onChange={(e) => setIncludeSuspended(e.target.checked)}
            />
            <span className="text-muted-foreground">
              Incluir suspendidos
            </span>
          </label>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Nuevo inquilino
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Error al cargar inquilinos.
          <Button
            variant="ghost"
            size="sm"
            className="ml-2"
            onClick={() => void refresh()}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="w-[64px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No hay inquilinos.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((t) => (
                <TableRow key={t.id} className="cursor-pointer">
                  <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={t.status === 'active' ? 'default' : 'secondary'}
                      className={
                        t.status === 'suspended'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : ''
                      }
                    >
                      {t.status === 'active' ? 'Activo' : 'Suspendido'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(t.created_at)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="inline-flex items-center text-primary hover:text-primary/80"
                      aria-label={`Ver ${t.name}`}
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateTenantDialog
        open={isCreateOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void refresh();
        }}
      />
    </div>
  );
}

interface CreateTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateTenantDialog({ open, onOpenChange, onCreated }: CreateTenantDialogProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  function reset() {
    setSlug('');
    setName('');
    setErrors({});
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const parsed = createTenantSchema.safeParse({ slug, name });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join('.');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createTenant(parsed.data);
      toast.success(`Inquilino "${created.name}" creado`);
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      surfaceApiError(err, {
        codeMap: {
          CONFLICT: 'Ese slug ya esta en uso',
        },
        fallback: 'No se pudo crear el inquilino',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo inquilino</DialogTitle>
          <DialogDescription>
            Crea una organizacion. El slug debe ser unico y no puede
            cambiar despues de crearse.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Slug"
            htmlFor="tenant-slug"
            error={errors.slug}
            description="3-63 caracteres. Solo minusculas, digitos y guion."
            required
          >
            <Input
              id="tenant-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme"
              autoComplete="off"
              // react-doctor: autoFocus retained for dialog focus management
              autoFocus
            />
          </FormField>

          <FormField label="Nombre" htmlFor="tenant-name" error={errors.name} required>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Co"
              autoComplete="off"
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}
