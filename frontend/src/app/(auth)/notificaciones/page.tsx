'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import { HugeiconsIcon } from '@hugeicons/react';
import { Notification03Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/shared/page-transition';
import type {
  Notification,
  NotificationType,
  PaginatedNotifications,
  DailySummary,
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

const SUMMARY_CARDS: {
  type: NotificationType;
  label: string;
  color: string;
}[] = [
  { type: 'stock_critical', label: 'Critico', color: 'text-red-600 dark:text-red-400' },
  { type: 'stock_low', label: 'Bajo', color: 'text-amber-600 dark:text-amber-400' },
  { type: 'stock_warning', label: 'Advertencia', color: 'text-yellow-600 dark:text-yellow-400' },
  { type: 'cycle_count_due', label: 'Conteo', color: 'text-blue-600 dark:text-blue-400' },
  { type: 'system', label: 'Sistema', color: 'text-gray-600 dark:text-gray-400' },
];

type FilterType = 'all' | 'unread' | 'read';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificacionesPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DailySummary | null>(null);

  const perPage = 20;

  const fetchNotifications = async (p: number, f: FilterType) => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/notifications?page=${p}&per_page=${perPage}`;
      if (f === 'unread') url += '&is_read=false';
      if (f === 'read') url += '&is_read=true';
      const res = await api.get<PaginatedNotifications>(url);
      setNotifications(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar notificaciones');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.get<DailySummary>('/notifications/daily-summary');
      setSummary(res);
    } catch {
      // non-critical, ignore
    }
  };

  useEffect(() => {
    fetchNotifications(page, filter);
  }, [page, filter]);

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await api.put<ReadAllResponse>('/notifications/read-all');
      fetchNotifications(page, filter);
      fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar como leidas');
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      fetchNotifications(page, filter);
      fetchSummary();
    } catch {
      // silently fail
    }
  };

  const handleFilterChange = (value: string) => {
    setFilter(value as FilterType);
    setPage(1);
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <HugeiconsIcon icon={Notification03Icon} size={28} className="text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Resumen y listado de alertas del sistema
          </p>
        </div>
      </div>

      {/* Daily summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {SUMMARY_CARDS.map(({ type, label, color }, i) => (
            <Card key={type} size="sm" className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
              <CardContent className="flex flex-col items-center gap-1 pt-4 pb-3">
                <span className={cn('text-2xl font-bold', color)}>
                  {summary.by_type[type]}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <Select value={filter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="unread">No leidas</SelectItem>
            <SelectItem value="read">Leidas</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
          Marcar todas como leidas
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Notification list */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            {total} {total === 1 ? 'notificacion' : 'notificaciones'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-0 divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-6 py-4">
                  <Skeleton className="size-2 shrink-0 rounded-full mt-1.5" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No hay notificaciones
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-3 px-6 py-4">
                  {/* Unread dot */}
                  <div className="mt-1.5 shrink-0">
                    {!n.is_read ? (
                      <span className="block size-2 rounded-full bg-blue-500" />
                    ) : (
                      <span className="block size-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          TYPE_COLORS[n.notification_type]
                        )}
                      >
                        {TYPE_LABELS[n.notification_type]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(n.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                  </div>

                  {/* Mark read */}
                  {!n.is_read && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleMarkRead(n.id)}
                      aria-label="Marcar como leida"
                      className="shrink-0 mt-1"
                    >
                      <HugeiconsIcon icon={Tick02Icon} size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Pagina {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
