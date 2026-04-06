'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { CommandPalette } from '@/components/shared/command-palette';
import { CriticalAlertBanner } from '@/components/shared/critical-alert-banner';
import { useAutoTheme } from '@/hooks/use-auto-theme';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, isHydrated } = useAuthStore();
  const router = useRouter();
  useAutoTheme();

  useEffect(() => {
    if (isHydrated && !user) {
      router.replace('/login');
    }
  }, [isHydrated, user, router]);

  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <CommandPalette />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <CriticalAlertBanner />
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
