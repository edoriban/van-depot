'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

export default function FloorLayout({ children }: { children: React.ReactNode }) {
  const { user, isHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isHydrated && !user) {
      router.replace('/login');
    }
  }, [isHydrated, user, router]);

  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" data-testid="floor-layout">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            onClick={() => {
              if (typeof window !== 'undefined') {
                sessionStorage.setItem('vandepot_prefer_desktop', 'true');
              }
            }}
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            data-testid="floor-back-link"
          >
            Ir al escritorio
          </Link>
        </div>
        <span className="text-lg font-bold tracking-tight">VanDepot</span>
        <span className="text-sm text-zinc-400 truncate max-w-[120px]">{user.name}</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
