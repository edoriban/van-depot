'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { HugeiconsIcon } from '@hugeicons/react';
import { Notification03Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationPanel } from './notification-panel';
import type { UnreadCount } from '@/types';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<UnreadCount>('/notifications/unread-count', {
    refreshInterval: 30_000,
  });
  const count = data?.count ?? 0;

  const displayCount = count > 99 ? '99+' : String(count);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notificaciones"
        >
          <HugeiconsIcon icon={Notification03Icon} size={20} />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {displayCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 p-0 sm:w-96"
        sideOffset={8}
      >
        <NotificationPanel onClose={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
