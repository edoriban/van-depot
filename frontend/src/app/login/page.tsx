'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Mail,
  Eye,
  EyeOff,
  Lock,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export default function LoginPage() {
  const { login, isHydrated, user } = useAuthStore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) router.replace('/inicio');
  }, [user, router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace('/inicio');
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
        {/* Background pattern overlay */}
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

        {/* Decorative shapes */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/5 blur-3xl" />

        {/* Content */}
        <div className="relative z-10 max-w-lg px-12 text-white">
          {/* Logo */}
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

          {/* Headline */}
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Gestiona tu inventario con inteligencia
          </h1>

          {/* Subtitle */}
          <p className="text-lg text-white/80 mb-10 leading-relaxed">
            Control total de tu almacen, stock en tiempo real, y flujo de
            materiales optimizado.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-4">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-white/90 shrink-0" />
                <span className="text-white/90 text-base">{feature}</span>
              </li>
            ))}
          </ul>

          {/* Decorative divider */}
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
          {/* Mobile logo */}
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
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

            {/* Password */}
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

            {/* Forgot password */}
            <div className="flex justify-end">
              <Link
                href="/recuperar"
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in-up">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
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

          {/* Register link */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            No tienes cuenta?{' '}
            <Link
              href="/registro"
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Crear cuenta
            </Link>
          </div>

          {/* Footer */}
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
