'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Image from 'next/image';
import {
  Mail,
  Eye,
  EyeOff,
  Lock,
  User,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export default function RegistroPage() {
  const { push } = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): string | null {
    if (!name.trim()) return 'El nombre es requerido';
    if (!email.trim()) return 'El correo es requerido';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return 'El correo no es valido';
    if (password.length < 8)
      return 'La contrasena debe tener al menos 8 caracteres';
    if (password !== confirmPassword) return 'Las contrasenas no coinciden';
    if (!acceptTerms) return 'Debes aceptar los terminos de servicio';
    return null;
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error al crear cuenta' }));
        throw new Error(data.error || 'Error al crear cuenta');
      }

      toast.success('Cuenta creada exitosamente. Inicia sesion.');
      push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear cuenta');
    } finally {
      setIsSubmitting(false);
    }
  }

  const features = [
    'Sin tarjeta de credito',
    'Configuracion en 5 minutos',
    'Soporte incluido',
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
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-[500px] rounded-full bg-white/5 blur-3xl" />

        {/* Content */}
        <div className="relative z-10 max-w-lg px-12 text-white">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-12">
            <Image
              src="/vanflux-icon.svg"
              alt="VanFlux"
              width={48}
              height={48}
              className="brightness-0 invert"
            />
            <span className="text-3xl font-bold tracking-tight">VanFlux</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-semibold leading-tight mb-4">
            Empieza a controlar tu inventario
          </h1>

          {/* Subtitle */}
          <p className="text-lg text-white/80 mb-10 leading-relaxed">
            Crea tu cuenta en minutos y gestiona tu almacen de forma
            inteligente.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-4">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-white/90 shrink-0" />
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

      {/* Right panel - Register form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12 lg:px-16">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex flex-col items-center mb-10">
            <Image
              src="/vanflux-icon.svg"
              alt="VanFlux"
              width={72}
              height={72}
              className="mb-3"
            />
            <h2 className="text-2xl font-semibold tracking-tight">Crear cuenta</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Registrate para comenzar
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Nombre completo</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Juan Perez"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="pl-10"
                />
              </div>
            </div>

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

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Contrasena</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
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
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar contrasena</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repite tu contrasena"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={
                    showConfirmPassword
                      ? 'Ocultar contrasena'
                      : 'Mostrar contrasena'
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Terms checkbox */}
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="terms"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 size-4 rounded border-border accent-primary"
              />
              <Label
                htmlFor="terms"
                className="text-sm font-normal text-muted-foreground cursor-pointer leading-snug"
              >
                Acepto los{' '}
                <Link
                  href="/terminos"
                  className="text-primary hover:text-primary/80 transition-colors underline"
                >
                  Terminos de servicio
                </Link>{' '}
                y la{' '}
                <Link
                  href="/privacidad"
                  className="text-primary hover:text-primary/80 transition-colors underline"
                >
                  Politica de privacidad
                </Link>
              </Label>
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
                  Creando cuenta…
                </>
              ) : (
                'Crear cuenta'
              )}
            </Button>
          </form>

          {/* Login link */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            Ya tienes cuenta?{' '}
            <Link
              href="/login"
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Iniciar sesion
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
    </div>
  );
}
