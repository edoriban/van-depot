/**
 * /admin/* layout — superadmin-only guard.
 *
 * Bounces non-superadmin users to /inicio (the standard authenticated
 * landing page); unauthenticated users to /login. Renders nothing while the
 * auth store is rehydrating to avoid a flash of admin chrome.
 */
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, ChevronLeft, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!isHydrated) return;
    if (!user && !isSuperadmin) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!isSuperadmin) {
      router.replace('/inicio');
    }
  }, [isHydrated, isSuperadmin, user, router, pathname]);

  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }
  if (!isSuperadmin) {
    return null;
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort.
    }
    logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/admin/tenants" className="flex items-center gap-2 font-semibold">
            <Building2 className="h-5 w-5 text-primary" />
            <span>Admin</span>
          </Link>
          <span className="text-muted-foreground text-sm">/</span>
          <span className="text-sm text-muted-foreground">Inquilinos</span>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleLogout}
              className="gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
              Salir
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8">
        <Link
          href="/inicio"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Volver al panel
        </Link>
      </footer>
    </div>
  );
}
