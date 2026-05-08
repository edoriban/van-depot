'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Mail,
  Eye,
  EyeOff,
  Lock,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { LoginResponse } from '@/types';

/**
 * Drives `POST /api/auth/login` and dispatches per response shape (A17 of
 * `sdd/multi-tenant-foundation`):
 *   - superadmin Final           → /admin/tenants
 *   - single-membership Final    → /inicio
 *   - MultiTenant (>1)           → /select-tenant
 *   - 0 memberships, non-super   → 403 toast + clear store + stay on /login
 *   - 4xx other                  → inline error message
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dispatchLogin = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);
  const intermediateToken = useAuthStore((s) => s.intermediateToken);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const fromParam = searchParams.get('from');
  const redirectTo = fromParam && fromParam.startsWith('/') ? fromParam : '/inicio';

  // If we already have a session, send the user where they belong.
  useEffect(() => {
    if (!isHydrated) return;
    if (isSuperadmin) {
      router.replace('/admin/tenants');
      return;
    }
    if (user) {
      router.replace(redirectTo);
      return;
    }
    if (intermediateToken) {
      router.replace('/select-tenant');
    }
  }, [isHydrated, user, isSuperadmin, intermediateToken, router, redirectTo]);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Error al iniciar sesion' }));
        const message = typeof body?.error === 'string' ? body.error : 'Error al iniciar sesion';
        // 403 with `no_tenant_access` → spec says: clear store + toast + stay on /login.
        if (res.status === 403 && /no_tenant_access/i.test(message)) {
          logout();
          toast.error('Sin acceso a ningun inquilino. Contacta a tu administrador.');
          return;
        }
        setError(translateLoginError(message));
        return;
      }

      const data = (await res.json()) as LoginResponse;

      // Final branch
      if ('access_token' in data) {
        dispatchLogin(data);
        if (data.is_superadmin) {
          router.replace('/admin/tenants');
        } else {
          router.replace(redirectTo);
        }
        return;
      }

      // MultiTenant branch — pick a tenant.
      dispatchLogin(data);
      router.replace('/select-tenant');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesion');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Fallback: if hydration takes too long (e.g. bfcache restore), force it
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setForceReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  if (!isHydrated && !forceReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  const features = [
    'Inventario en tiempo real',
    'Alertas de stock inteligentes',
    'Trazabilidad completa',
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left panel - Hero / Branding */}
      <div className="hidden lg:flex lg:w-3/5 relative bg-gradient-to-br from-primary/90 via-primary/70 to-primary/50 items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 25% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 75%, white 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        </div>

        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/5 blur-3xl" />

        <div className="relative z-10 max-w-lg px-12 text-white">
          <div className="flex items-center gap-3 mb-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vanflux-icon.svg"
              alt="VanFlux"
              width={48}
              height={48}
              className="brightness-0 invert"
            />
            <span className="text-3xl font-bold tracking-tight">VanFlux</span>
          </div>

          <h1 className="text-4xl font-bold leading-tight mb-4">
            Gestiona tu inventario con inteligencia
          </h1>

          <p className="text-lg text-white/80 mb-10 leading-relaxed">
            Control total de tu almacen, stock en tiempo real, y flujo de
            materiales optimizado.
          </p>

          <ul className="space-y-4">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-white/90 shrink-0" />
                <span className="text-white/90 text-base">{feature}</span>
              </li>
            ))}
          </ul>

          <div className="mt-12 pt-8 border-t border-white/20">
            <p className="text-sm text-white/60">
              Confiado por equipos de almacen en toda Latinoamerica
            </p>
          </div>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12 lg:px-16">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vanflux-icon.svg"
              alt="VanFlux"
              width={72}
              height={72}
              className="mb-3"
            />
            <h2 className="text-2xl font-bold tracking-tight lg:hidden">VanFlux</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Ingresa a tu cuenta
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electronico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contrasena</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={
                    showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                href="/recuperar"
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in-up">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                'Iniciar sesion'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            No tienes cuenta?{' '}
            <Link
              href="/registro"
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Crear cuenta
            </Link>
          </div>

          <div className="mt-12 flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <a
                href="/terminos"
                className="hover:text-foreground transition-colors"
              >
                Terminos de servicio
              </a>
              <span aria-hidden="true">&middot;</span>
              <a
                href="/privacidad"
                className="hover:text-foreground transition-colors"
              >
                Politica de privacidad
              </a>
            </div>
            <p>&copy; 2026 VanFlux. Todos los derechos reservados.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function translateLoginError(message: string): string {
  if (/invalid credentials/i.test(message)) return 'Credenciales invalidas';
  if (/deactivated/i.test(message)) return 'La cuenta esta desactivada';
  if (/not yet activated/i.test(message))
    return 'Cuenta sin activar. Usa tu codigo de invitacion.';
  return message;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
