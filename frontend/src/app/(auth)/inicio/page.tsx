'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-mutations';
import type { DashboardStats, MovementType, AlertSummary } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Package01Icon,
  Store01Icon,
  ClipboardIcon,
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  Calendar01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/shared/page-transition';
import Link from 'next/link';

// --- Trend helpers ---

const STATS_STORAGE_KEY = 'vanflux_dashboard_prev_stats';

interface StoredStats {
  stats: DashboardStats;
  timestamp: number;
}

function loadPreviousStats(): DashboardStats | null {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: StoredStats = JSON.parse(raw);
    return parsed.stats;
  } catch {
    return null;
  }
}

function savePreviousStats(stats: DashboardStats): void {
  try {
    const stored: StoredStats = { stats, timestamp: Date.now() };
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable
  }
}

type TrendDirection = 'up' | 'down' | 'neutral';

interface TrendInfo {
  direction: TrendDirection;
  diff: number;
}

/** For most KPIs, "up" is good. For low_stock_count, "down" is good. */
function computeTrend(
  key: keyof DashboardStats,
  current: number,
  previous: number
): TrendInfo {
  const diff = current - previous;
  if (diff === 0) return { direction: 'neutral', diff: 0 };
  return { direction: diff > 0 ? 'up' : 'down', diff };
}

function isTrendPositive(key: keyof DashboardStats, direction: TrendDirection): boolean {
  const invertedKeys: (keyof DashboardStats)[] = ['low_stock_count'];
  if (invertedKeys.includes(key)) {
    return direction === 'down';
  }
  return direction === 'up';
}

// --- Types for API responses ---

interface RecentMovement {
  id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  product_name: string;
  product_sku: string;
  from_location_name: string | null;
  to_location_name: string | null;
  user_name: string;
  created_at: string;
}

interface LowStockItem {
  product_id: string;
  product_name: string;
  product_sku: string;
  location_name: string;
  quantity: number;
  min_stock: number;
}

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'justo ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHrs < 24) return `hace ${diffHrs} h`;
  if (diffDays < 7) return `hace ${diffDays} d`;
  return date.toLocaleDateString('es-MX');
}

const movementTypeConfig: Record<MovementType, { label: string; className: string }> = {
  entry: { label: 'Entrada', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  exit: { label: 'Salida', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  transfer: { label: 'Transferencia', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  adjustment: { label: 'Ajuste', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

// --- KPI Card config ---

interface KpiConfig {
  key: keyof DashboardStats;
  label: string;
  description: string;
  icon: typeof Package01Icon;
  isWarning?: boolean;
  href: string;
}

const kpiCards: KpiConfig[] = [
  { key: 'total_products', label: 'Total Productos', description: 'Productos activos en tu catalogo', icon: Package01Icon, href: '/productos' },
  { key: 'total_warehouses', label: 'Total Almacenes', description: 'Almacenes registrados', icon: Store01Icon, href: '/almacenes' },
  { key: 'total_stock_items', label: 'Items en Stock', description: 'Productos con existencias', icon: ClipboardIcon, href: '/inventario' },
  { key: 'low_stock_count', label: 'Stock Bajo', description: 'Requieren atencion', icon: Alert02Icon, isWarning: true, href: '/alertas' },
  { key: 'movements_today', label: 'Movimientos Hoy', description: 'Entradas, salidas y transferencias', icon: ArrowDataTransferHorizontalIcon, href: '/movimientos' },
  { key: 'movements_this_week', label: 'Movimientos Semana', description: 'Ultimos 7 dias', icon: Calendar01Icon, href: '/movimientos' },
];

// --- Quick Action config ---

interface QuickAction {
  href: string;
  icon: typeof Package01Icon;
  label: string;
  description: string;
  color: string;
}

const quickActions: QuickAction[] = [
  {
    href: '/movimientos',
    icon: ArrowDown01Icon,
    label: 'Registrar entrada',
    description: 'Material que llega',
    color: 'text-green-500',
  },
  {
    href: '/movimientos',
    icon: ArrowUp01Icon,
    label: 'Registrar salida',
    description: 'Material que sale',
    color: 'text-red-500',
  },
  {
    href: '/productos',
    icon: Package01Icon,
    label: 'Nuevo producto',
    description: 'Agregar al catalogo',
    color: 'text-blue-500',
  },
  {
    href: '/inventario',
    icon: Search01Icon,
    label: 'Buscar material',
    description: '¿Donde esta?',
    color: 'text-amber-500',
  },
];

// --- Component ---

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [movements, setMovements] = useState<RecentMovement[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevStats, setPrevStats] = useState<DashboardStats | null>(null);

  // Load previous stats from localStorage on mount
  useEffect(() => {
    const prev = loadPreviousStats();
    if (prev) setPrevStats(prev);
  }, []);

  // Save current stats to localStorage when they arrive
  useEffect(() => {
    if (stats) savePreviousStats(stats);
  }, [stats]);

  // Detect mobile and redirect to floor mode
  useEffect(() => {
    const isMobile =
      window.innerWidth < 768 ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      const cameFromPiso = sessionStorage.getItem('vanflux_prefer_desktop');
      if (!cameFromPiso) {
        window.location.href = '/piso';
      }
    }
  }, []);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        setIsLoading(true);
        setError(null);

        const [statsRes, movementsRes, lowStockRes, alertSummaryRes] = await Promise.all([
          api.get<DashboardStats>('/dashboard/stats'),
          api.get<RecentMovement[]>('/dashboard/recent-movements'),
          api.get<{ data: LowStockItem[] }>('/reports/low-stock?per_page=5'),
          api.get<AlertSummary>('/alerts/summary'),
        ]);

        setStats(statsRes);
        setMovements(movementsRes);
        setLowStock(lowStockRes.data ?? lowStockRes as unknown as LowStockItem[]);
        setAlertSummary(alertSummaryRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar el dashboard');
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboard();
  }, []);

  const isBrandNewAccount =
    !isLoading &&
    stats !== null &&
    stats.total_warehouses === 0;

  if (error) {
    return (
      <div className="space-y-4">
        <DashboardHeader userName={user?.name} />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive font-medium">Error al cargar datos</p>
            <p className="text-muted-foreground text-sm mt-1">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <DashboardHeader userName={user?.name} />

      {/* Welcome Banner for brand new accounts */}
      {isBrandNewAccount ? (
        <Card className="border-primary/30 bg-primary/5" data-testid="welcome-banner">
          <CardContent className="p-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vanflux-icon.svg" alt="VanFlux" className="size-12 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">¡Bienvenido a VanFlux!</h2>
            <p className="text-muted-foreground mb-4">
              Configura tu almacen en unos minutos para empezar a controlar tu inventario.
            </p>
            <Button asChild>
              <Link href="/onboarding">Comenzar configuracion</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* KPI Cards */
        <div data-testid="kpi-cards" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
            : kpiCards.map((kpi, i) => {
                const currentVal = stats?.[kpi.key] ?? 0;
                const trend = prevStats
                  ? computeTrend(kpi.key, currentVal, prevStats[kpi.key])
                  : null;
                return (
                  <KpiCard
                    key={kpi.key}
                    kpiKey={kpi.key}
                    label={kpi.label}
                    value={currentVal}
                    description={kpi.description}
                    icon={kpi.icon}
                    isWarning={kpi.isWarning}
                    href={kpi.href}
                    trend={trend}
                    index={i}
                  />
                );
              })}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="quick-actions">
        {quickActions.map((action, i) => (
          <QuickActionCard key={action.label} {...action} index={i} />
        ))}
      </div>

      {/* Main content: Movements + Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Movements */}
        <div className="lg:col-span-2" data-testid="recent-movements">
          <Card>
            <CardHeader>
              <CardTitle>Movimientos Recientes</CardTitle>
              <CardDescription>Ultimos movimientos registrados</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <MovementsSkeleton />
              ) : movements.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No hay movimientos recientes
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead>Origen / Destino</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="text-right">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((mov) => {
                      const config = movementTypeConfig[mov.movement_type];
                      return (
                        <TableRow key={mov.id}>
                          <TableCell>
                            <Badge variant="outline" className={cn('border-0', config.className)}>
                              {config.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Link href={`/productos/${mov.product_id}`} className="font-medium hover:underline">
                              {mov.product_name}
                            </Link>
                            <div className="text-muted-foreground text-xs">{mov.product_sku}</div>
                          </TableCell>
                          <TableCell>
                            <span className="text-muted-foreground text-xs">
                              {mov.from_location_name ?? '—'} → {mov.to_location_name ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">{mov.quantity}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{mov.user_name}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {timeAgo(mov.created_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Low Stock Alert */}
        <div data-testid="low-stock-alert">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <HugeiconsIcon icon={Alert02Icon} size={18} className="text-amber-500" />
                  Stock Bajo
                </CardTitle>
                <Link
                  href="/alertas"
                  className="text-sm text-[var(--link)] hover:underline"
                  data-testid="link-alertas"
                >
                  Ver todas
                </Link>
              </div>
              <CardDescription>
                Productos debajo del minimo
                {alertSummary && alertSummary.total_alerts > 0 && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium" data-testid="alert-count">
                    ({alertSummary.total_alerts} alertas)
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LowStockSkeleton />
              ) : lowStock.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No hay productos con stock bajo
                </p>
              ) : (
                <div className="space-y-3">
                  {lowStock.map((item) => {
                    const pct = item.min_stock > 0 ? Math.round((item.quantity / item.min_stock) * 100) : 0;
                    return (
                      <div key={`${item.product_id}-${item.location_name}`} className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{item.product_name}</p>
                          <p className="text-muted-foreground text-xs truncate">
                            {item.product_sku} &middot; {item.location_name}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={cn(
                            'font-semibold text-sm',
                            pct <= 25 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                          )}>
                            {item.quantity} / {item.min_stock}
                          </p>
                          <div className="w-16 h-1.5 bg-muted rounded-full mt-1">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                pct <= 25 ? 'bg-red-500' : 'bg-amber-500'
                              )}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </PageTransition>
  );
}

// --- Sub-components ---

function DashboardHeader({ userName }: { userName?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground mt-1">
        Bienvenido, {userName ?? 'usuario'}
      </p>
    </div>
  );
}

function QuickActionCard({
  href,
  icon,
  label,
  description,
  color,
  index = 0,
}: QuickAction & { index?: number }) {
  return (
    <Link href={href}>
      <Card
        className="animate-fade-in-up hover:border-primary/50 transition-colors cursor-pointer"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <HugeiconsIcon icon={icon} className={cn('size-8', color)} />
          <div>
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiCard({
  kpiKey,
  label,
  value,
  description,
  icon,
  isWarning,
  href,
  trend,
  index = 0,
}: {
  kpiKey: keyof DashboardStats;
  label: string;
  value: number;
  description: string;
  icon: typeof Package01Icon;
  isWarning?: boolean;
  href: string;
  trend: TrendInfo | null;
  index?: number;
}) {
  const showTrend = trend && trend.direction !== 'neutral';
  const positive = showTrend ? isTrendPositive(kpiKey, trend.direction) : false;

  return (
    <Link href={href}>
      <Card
        size="sm"
        className="animate-fade-in-up hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardDescription className="text-xs">{label}</CardDescription>
            <HugeiconsIcon
              icon={icon}
              size={18}
              className={cn(
                'text-muted-foreground',
                isWarning && value > 0 && 'text-amber-500'
              )}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-1.5">
            <p className={cn(
              'text-2xl font-bold',
              isWarning && value > 0 && 'text-amber-600 dark:text-amber-400'
            )}>
              {value.toLocaleString('es-MX')}
            </p>
            {showTrend && (
              <span className={cn(
                'flex items-center gap-0.5 text-xs font-medium',
                positive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}>
                <HugeiconsIcon
                  icon={trend.direction === 'up' ? ArrowUp01Icon : ArrowDown01Icon}
                  size={12}
                />
                {Math.abs(trend.diff)} vs ayer
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs mt-1">{description}</p>
          <p className="text-xs text-[var(--link)]/60 group-hover:text-[var(--link)] mt-2 transition-colors">
            Ver detalles &rarr;
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiSkeleton() {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="size-4 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-16 mb-2" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

function MovementsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-12 ml-auto" />
        </div>
      ))}
    </div>
  );
}

function LowStockSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div>
            <Skeleton className="h-4 w-28 mb-1" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
