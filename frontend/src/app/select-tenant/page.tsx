/**
 * /select-tenant — post-login membership picker (A18 of
 * `sdd/multi-tenant-foundation`).
 *
 * Guard: requires `intermediateToken` in the auth store. Without one, we
 * bounce to /login. The intermediate token is in-memory ONLY — see
 * `stores/auth-store.ts`'s `partialize`.
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { Loader2, Building2, ChevronRight, AlertCircle } from 'lucide-react';
import type {
  AvailableTenant,
  LoginResponseFinal,
  TenantRole,
} from '@/types';
import { TENANT_ROLE_LABELS } from '@/types';

export default function SelectTenantPage() {
  const router = useRouter();
  const intermediateToken = useAuthStore((s) => s.intermediateToken);
  const availableTenants = useAuthStore((s) => s.availableTenants);
  const dispatchSelect = useAuthStore((s) => s.selectTenant);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const logout = useAuthStore((s) => s.logout);

  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isHydrated) return;
    if (!intermediateToken) {
      router.replace('/login');
    }
  }, [isHydrated, intermediateToken, router]);

  async function handlePick(tenant: AvailableTenant) {
    if (!intermediateToken) {
      router.replace('/login');
      return;
    }
    setError('');
    setPendingTenantId(tenant.tenant_id);

    try {
      const res = await fetch('/api/auth/select-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenant.tenant_id,
          intermediate_token: intermediateToken,
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Error al seleccionar el inquilino' }));
        const msg = typeof body?.error === 'string' ? body.error : 'Error al seleccionar el inquilino';
        if (res.status === 401 || res.status === 403) {
          // Intermediate token expired/invalid — kick the user back to login.
          logout();
          router.replace('/login');
          return;
        }
        setError(msg);
        return;
      }

      const data = (await res.json()) as LoginResponseFinal;
      dispatchSelect(data);
      router.replace('/inicio');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexion');
    } finally {
      setPendingTenantId(null);
    }
  }

  if (!isHydrated || !intermediateToken) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Selecciona un inquilino
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu cuenta tiene acceso a varios inquilinos. Elige con cual quieres
            iniciar sesion.
          </p>
        </header>

        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <ul className="space-y-2">
          {availableTenants.map((t) => {
            const isPending = pendingTenantId === t.tenant_id;
            const disabled = pendingTenantId !== null;
            return (
              <li key={t.tenant_id}>
                <button
                  type="button"
                  onClick={() => handlePick(t)}
                  disabled={disabled}
                  className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">{t.tenant_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.tenant_slug} &middot; {tenantRoleLabel(t.role)}
                      </div>
                    </div>
                  </div>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            disabled={pendingTenantId !== null}
          >
            Cancelar y volver a iniciar sesion
          </Button>
        </div>
      </div>
    </div>
  );
}

function tenantRoleLabel(role: TenantRole): string {
  return TENANT_ROLE_LABELS[role] ?? role;
}
