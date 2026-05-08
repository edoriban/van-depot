/**
 * /admin/tenants/[id] — superadmin tenant detail (A19 detail view).
 *
 * Capabilities:
 *   - Edit name + suspend/reactivate (PATCH).
 *   - Soft-delete (DELETE) with confirm.
 *   - Memberships: list, grant, revoke.
 *   - "Seed demo data" placeholder (Phase D — disabled).
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Loader2, Trash2, ArrowLeft, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { surfaceApiError } from '@/lib/api';
import { use } from 'react';
import {
  deleteTenant,
  getTenant,
  grantMembership,
  listMemberships,
  membershipsKey,
  revokeMembership,
  tenantKey,
  tenantsKey,
  updateTenant,
} from '@/lib/api/tenants';
import {
  grantMembershipSchema,
  updateTenantSchema,
} from '@/features/admin-tenants/schema';
import { SeedDemoModal } from '@/features/admin-tenants/seed-demo-modal';
import type { MembershipResponse, SeedDemoSummary } from '@/lib/api/tenants';
import { TENANT_ROLE_LABELS } from '@/types';
import type { Tenant, TenantRole } from '@/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AdminTenantDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const tenantSwr = useSWR<Tenant>(tenantKey(id), () => getTenant(id));
  const membershipsSwr = useSWR<MembershipResponse[]>(
    membershipsKey(id),
    () => listMemberships(id),
  );

  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isGrantOpen, setGrantOpen] = useState(false);
  const [isSeedOpen, setSeedOpen] = useState(false);

  const tenant = tenantSwr.data;
  const memberships = membershipsSwr.data ?? [];

  if (tenantSwr.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tenantSwr.error || !tenant) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </Link>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          No se pudo cargar el inquilino.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Volver al listado
        </Link>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {tenant.slug}
            </p>
          </div>
          <Badge
            className={
              tenant.status === 'suspended'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : ''
            }
          >
            {tenant.status === 'active' ? 'Activo' : 'Suspendido'}
          </Badge>
        </div>
      </div>

      <TenantSettingsCard tenant={tenant} />

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Miembros</h2>
            <p className="text-sm text-muted-foreground">
              Usuarios con acceso a este inquilino.
            </p>
          </div>
          <Button size="sm" onClick={() => setGrantOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Agregar miembro
          </Button>
        </div>

        <div className="rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {membershipsSwr.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : memberships.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Sin miembros aun.
                  </TableCell>
                </TableRow>
              ) : (
                memberships.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {m.user_email ?? <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {m.user_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {TENANT_ROLE_LABELS[m.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(m.created_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={async () => {
                          if (!confirm(`Quitar acceso a ${m.user_email ?? m.user_id}?`)) {
                            return;
                          }
                          try {
                            await revokeMembership(id, m.user_id);
                            toast.success('Acceso revocado');
                            await mutate(membershipsKey(id));
                          } catch (err) {
                            surfaceApiError(err, {
                              fallback: 'No se pudo revocar el acceso',
                            });
                          }
                        }}
                        aria-label="Revocar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Acciones avanzadas</h2>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeedOpen(true)}
            >
              Cargar datos demo
            </Button>
            <p className="text-xs text-muted-foreground">
              Agrega datos de ejemplo. Es seguro re-ejecutarlo.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Eliminar inquilino
          </Button>
        </div>
      </section>

      <DeleteTenantDialog
        open={isDeleteOpen}
        onOpenChange={setDeleteOpen}
        tenant={tenant}
        onDeleted={() => {
          void mutate(tenantsKey(false));
          void mutate(tenantsKey(true));
          router.replace('/admin/tenants');
        }}
      />

      <GrantMembershipDialog
        open={isGrantOpen}
        onOpenChange={setGrantOpen}
        tenantId={id}
      />

      <SeedDemoModal
        open={isSeedOpen}
        tenant={{ id: tenant.id, slug: tenant.slug, name: tenant.name }}
        onClose={() => setSeedOpen(false)}
        onSuccess={(summary) => {
          handleSeedSuccess(summary, tenant.name);
          void mutate(tenantKey(id));
          void mutate(membershipsKey(id));
        }}
      />
    </div>
  );
}

/**
 * Render the success toast after a seed-demo call. If every counter is zero
 * the tenant was already seeded — surface the idempotent-no-op message
 * instead of a generic success.
 */
function handleSeedSuccess(summary: SeedDemoSummary, tenantName: string): void {
  const total =
    summary.warehouses +
    summary.locations +
    summary.categories +
    summary.suppliers +
    summary.products +
    summary.recipes +
    summary.work_orders +
    summary.purchase_orders +
    summary.cycle_counts +
    summary.notifications +
    summary.demo_users +
    summary.memberships;

  if (total === 0) {
    toast.info('Datos demo ya presentes — no se agrego nada nuevo.');
    return;
  }

  const parts: string[] = [];
  if (summary.warehouses)
    parts.push(`${summary.warehouses} almacen${summary.warehouses === 1 ? '' : 'es'}`);
  if (summary.locations)
    parts.push(`${summary.locations} ubicaci${summary.locations === 1 ? 'on' : 'ones'}`);
  if (summary.categories)
    parts.push(`${summary.categories} categori${summary.categories === 1 ? 'a' : 'as'}`);
  if (summary.suppliers)
    parts.push(`${summary.suppliers} proveedor${summary.suppliers === 1 ? '' : 'es'}`);
  if (summary.products)
    parts.push(`${summary.products} producto${summary.products === 1 ? '' : 's'}`);
  if (summary.recipes)
    parts.push(`${summary.recipes} receta${summary.recipes === 1 ? '' : 's'}`);
  if (summary.work_orders)
    parts.push(`${summary.work_orders} OT`);
  if (summary.purchase_orders)
    parts.push(`${summary.purchase_orders} OC`);
  if (summary.cycle_counts)
    parts.push(`${summary.cycle_counts} conteo${summary.cycle_counts === 1 ? '' : 's'}`);
  if (summary.notifications)
    parts.push(
      `${summary.notifications} notificaci${summary.notifications === 1 ? 'on' : 'ones'}`,
    );
  if (summary.demo_users)
    parts.push(`${summary.demo_users} usuario${summary.demo_users === 1 ? '' : 's'} demo`);
  if (summary.memberships)
    parts.push(`${summary.memberships} membresia${summary.memberships === 1 ? '' : 's'}`);

  toast.success(`Datos demo agregados a ${tenantName}`, {
    description: parts.join(', '),
  });
}

interface TenantSettingsCardProps {
  tenant: Tenant;
}

function TenantSettingsCard({ tenant }: TenantSettingsCardProps) {
  const [name, setName] = useState(tenant.name);
  const [status, setStatus] = useState(tenant.status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  const dirty = name !== tenant.name || status !== tenant.status;

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const patch: { name?: string; status?: 'active' | 'suspended' } = {};
    if (name !== tenant.name) patch.name = name;
    if (status !== tenant.status) patch.status = status;
    const parsed = updateTenantSchema.safeParse(patch);
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
      await updateTenant(tenant.id, parsed.data);
      toast.success('Inquilino actualizado');
      await mutate(tenantKey(tenant.id));
      await mutate(tenantsKey(false));
      await mutate(tenantsKey(true));
    } catch (err) {
      surfaceApiError(err, {
        fallback: 'No se pudo actualizar el inquilino',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Configuracion</h2>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Nombre" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField label="Estado" htmlFor="status" error={errors.status}>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as 'active' | 'suspended')}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="suspended">Suspendido</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Slug" htmlFor="slug" description="No editable">
          <Input id="slug" value={tenant.slug} disabled />
        </FormField>

        <FormField label="Creado" htmlFor="created" description={formatDate(tenant.created_at)}>
          <Input id="created" value={formatDate(tenant.created_at)} disabled />
        </FormField>

        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={!dirty || isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar cambios
          </Button>
        </div>
      </form>
    </section>
  );
}

interface DeleteTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: Tenant;
  onDeleted: () => void;
}

function DeleteTenantDialog({
  open,
  onOpenChange,
  tenant,
  onDeleted,
}: DeleteTenantDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);

  const canConfirm = confirmText === tenant.slug;

  async function handleDelete() {
    setSubmitting(true);
    try {
      await deleteTenant(tenant.id);
      toast.success(`Inquilino "${tenant.name}" eliminado`);
      onOpenChange(false);
      setConfirmText('');
      onDeleted();
    } catch (err) {
      surfaceApiError(err, { fallback: 'No se pudo eliminar el inquilino' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmText('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar inquilino</DialogTitle>
          <DialogDescription>
            Esta accion realiza un soft-delete: el inquilino deja de ser
            visible y los usuarios pierden acceso, pero los datos
            permanecen para auditoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm">
            Para confirmar, escribe el slug{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              {tenant.slug}
            </code>{' '}
            a continuacion:
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant.slug}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!canConfirm || isSubmitting}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GrantMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
}

function GrantMembershipDialog({
  open,
  onOpenChange,
  tenantId,
}: GrantMembershipDialogProps) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<TenantRole>('operator');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  function reset() {
    setUserId('');
    setRole('operator');
    setErrors({});
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const parsed = grantMembershipSchema.safeParse({ user_id: userId, role });
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
      await grantMembership(tenantId, parsed.data);
      toast.success('Miembro agregado');
      reset();
      onOpenChange(false);
      await mutate(membershipsKey(tenantId));
    } catch (err) {
      surfaceApiError(err, { fallback: 'No se pudo agregar el miembro' });
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
          <DialogTitle>Agregar miembro</DialogTitle>
          <DialogDescription>
            Otorga acceso a este inquilino a un usuario existente. El usuario
            debe estar registrado en VanFlux.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="User ID"
            htmlFor="user-id"
            error={errors.user_id}
            description="UUID del usuario."
            required
          >
            <Input
              id="user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoFocus
            />
          </FormField>

          <FormField label="Rol" htmlFor="role" error={errors.role} required>
            <Select value={role} onValueChange={(v) => setRole(v as TenantRole)}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">{TENANT_ROLE_LABELS.owner}</SelectItem>
                <SelectItem value="manager">{TENANT_ROLE_LABELS.manager}</SelectItem>
                <SelectItem value="operator">
                  {TENANT_ROLE_LABELS.operator}
                </SelectItem>
              </SelectContent>
            </Select>
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
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Agregar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('es-MX');
  } catch {
    return iso;
  }
}
