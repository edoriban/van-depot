'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores/auth-store';
import type { LoginResponse } from '@/types';
import {
  Mail,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';

export default function ActivarPage() {
  const router = useRouter();
  const dispatchLogin = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.SubmitEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError('');

      if (!email.trim()) {
        setError('El correo es requerido');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('El correo no es valido');
        return;
      }
      if (!code.trim()) {
        setError('El codigo de activacion es requerido');
        return;
      }
      if (!newPassword) {
        setError('La contrasena es requerida');
        return;
      }
      if (newPassword.length < 6) {
        setError('La contrasena debe tener al menos 6 caracteres');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Las contrasenas no coinciden');
        return;
      }

      setIsSubmitting(true);

      try {
        const res = await fetch('/api/auth/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            code: code.trim(),
            new_password: newPassword,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Error al activar la cuenta' }));
          setError(data.error || data.detail || 'Codigo de activacion invalido');
          return;
        }

        const data = (await res.json()) as LoginResponse;
        dispatchLogin(data);

        if ('access_token' in data) {
          if (data.is_superadmin) {
            router.push('/admin/tenants');
          } else {
            router.push('/inicio');
          }
        } else {
          router.push('/select-tenant');
        }
      } catch {
        setError('Error de conexion. Intenta de nuevo.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, code, newPassword, confirmPassword, dispatchLogin, router],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/vanflux-icon.svg"
            alt="VanFlux"
            width={44}
            height={44}
            className="mb-3"
          />
          <h2 className="text-2xl font-bold tracking-tight">Activar cuenta</h2>
          <p className="mt-1.5 text-sm text-muted-foreground text-center">
            Ingresa tu correo, el codigo de activacion y establece tu contrasena
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Correo electronico</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="pl-10"
              />
            </div>
          </div>

          {/* Activation code */}
          <div className="space-y-2">
            <Label htmlFor="code">Codigo de activacion</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              className="font-mono tracking-widest"
            />
          </div>

          {/* New password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">Nueva contrasena</Label>
            <div className="relative">
              <Input
                id="new-password"
                name="new_password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Minimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar contrasena</Label>
            <Input
              id="confirm-password"
              name="confirm_password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Repite tu contrasena"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in-up">
              <AlertCircle className="size-4 shrink-0" />
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
                <Loader2 className="mr-2 size-4 animate-spin" />
                Activando…
              </>
            ) : (
              'Activar cuenta'
            )}
          </Button>
        </form>

        {/* Back to login */}
        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <ArrowLeft className="size-4" />
            Volver al inicio de sesion
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-12 flex flex-col items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <Link
              href="/terminos"
              className="hover:text-foreground transition-colors"
            >
              Terminos de servicio
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link
              href="/privacidad"
              className="hover:text-foreground transition-colors"
            >
              Politica de privacidad
            </Link>
          </div>
          <p>&copy; 2026 VanFlux. Todos los derechos reservados.</p>
        </div>
      </div>
    </div>
  );
}
