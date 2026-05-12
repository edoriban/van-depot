'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Image from 'next/image';
import {
  Mail,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';
const COOLDOWN_SECONDS = 60;

export default function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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

      setIsSubmitting(true);

      try {
        const res = await fetch(`${API_URL}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });

        if (!res.ok) {
          // If endpoint doesn't exist (404), show "coming soon"
          if (res.status === 404) {
            toast.info('Funcionalidad proximamente disponible');
            setSent(true);
            setCooldown(COOLDOWN_SECONDS);
            return;
          }
          // For any other error, still show success message for security
        }

        setSent(true);
        setCooldown(COOLDOWN_SECONDS);
      } catch {
        // Network error — endpoint likely doesn't exist
        toast.info('Funcionalidad proximamente disponible');
        setSent(true);
        setCooldown(COOLDOWN_SECONDS);
      } finally {
        setIsSubmitting(false);
      }
    },
    [email],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <Image
            src="/vanflux-icon.svg"
            alt="VanFlux"
            width={44}
            height={44}
            className="mb-3"
          />
          <h2 className="text-2xl font-semibold tracking-tight">
            Recuperar contrasena
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground text-center">
            Ingresa tu correo y te enviaremos instrucciones para restablecer tu
            contrasena
          </p>
        </div>

        {sent ? (
          /* Success state */
          <div className="space-y-6">
            <div className="flex items-start gap-3 rounded-md bg-primary/10 px-4 py-3.5 text-sm text-primary">
              <CheckCircle2 className="size-5 shrink-0 mt-0.5" />
              <p>
                Si el correo <strong>{email}</strong> esta registrado, recibiras
                instrucciones para restablecer tu contrasena.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <Button
                type="submit"
                className="w-full h-10"
                variant="outline"
                disabled={cooldown > 0 || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Enviando…
                  </>
                ) : cooldown > 0 ? (
                  `Reenviar instrucciones (${cooldown}s)`
                ) : (
                  'Reenviar instrucciones'
                )}
              </Button>
            </form>
          </div>
        ) : (
          /* Form state */
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
                  Enviando…
                </>
              ) : (
                'Enviar instrucciones'
              )}
            </Button>
          </form>
        )}

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
