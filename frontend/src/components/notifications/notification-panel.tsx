'use client';

import useSWR, { useSWRConfig } from 'swr';
import { api } from '@/lib/api-mutations';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import type {
  Notification,
  NotificationType,
  PaginatedNotifications,
  ReadAllResponse,
} from '@/types';

const TYPE_LABELS: Record<NotificationType, string> = {
  stock_critical: 'Critico',
  stock_low: 'Bajo',
  stock_warning: 'Advertencia',
  cycle_count_due: 'Conteo',
  system: 'Sistema',
};

const TYPE_COLORS: Record<NotificationType, string> = {
  stock_critical: 'bg-red-500/15 text-red-600 dark:text-red-400',
  stock_low: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  stock_warning: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  cycle_count_due: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  system: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'hace unos segundos';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

interface NotificationPanelProps {
  onClose: () => void;
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR<PaginatedNotifications>(
    '/notifications?per_page=10&page=1'
  );

  const notifications = data?.data ?? [];

  const handleMarkAllRead = async () => {
    try {
      await api.put<ReadAllResponse>('/notifications/read-all');
      mutate('/notifications/unread-count');
      mutate('/notifications?per_page=10&page=1');
    } catch {
      // silently fail
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      mutate('/notifications/unread-count');
      mutate('/notifications?per_page=10&page=1');
    } catch {
      // silently fail
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold">Notificaciones</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleMarkAllRead}
          className="text-xs text-muted-foreground"
        >
          Marcar todas leidas
        </Button>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No tienes notificaciones
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkRead={handleMarkRead}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-2">
        <Link
          href="/notificaciones"
          onClick={onClose}
          className="block text-center text-xs font-medium text-primary hover:underline"
        >
          Ver todas las notificaciones
        </Link>
      </div>
    </div>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
      {/* Unread dot */}
      <div className="mt-1.5 shrink-0">
        {!notification.is_read ? (
          <span className="block size-2 rounded-full bg-blue-500" />
        ) : (
          <span className="block size-2" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[notification.notification_type]}`}
          >
            {TYPE_LABELS[notification.notification_type]}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(notification.created_at)}
          </span>
        </div>
        <p className="truncate text-xs font-medium">{notification.title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {notification.body}
        </p>
      </div>

      {/* Mark read */}
      {!notification.is_read && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onMarkRead(notification.id)}
          aria-label="Marcar como leida"
          className="shrink-0"
        >
          <HugeiconsIcon icon={Tick02Icon} size={14} />
        </Button>
      )}
    </div>
  );
}
