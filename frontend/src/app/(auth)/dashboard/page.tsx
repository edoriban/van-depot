'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/features/auth/api';
import type { DashboardStats, MovementType, AlertSummary } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// --- Types for API responses ---

interface RecentMovement {
  id: string;
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
}

const kpiCards: KpiConfig[] = [
  { key: 'total_products', label: 'Total Productos', description: 'Productos registrados', icon: Package01Icon },
  { key: 'total_warehouses', label: 'Total Almacenes', description: 'Almacenes activos', icon: Store01Icon },
  { key: 'total_stock_items', label: 'Items en Stock', description: 'Items con existencia', icon: ClipboardIcon },
  { key: 'low_stock_count', label: 'Stock Bajo', description: 'Debajo del minimo', icon: Alert02Icon, isWarning: true },
  { key: 'movements_today', label: 'Movimientos Hoy', description: 'En las ultimas 24h', icon: ArrowDataTransferHorizontalIcon },
  { key: 'movements_this_week', label: 'Movimientos Semana', description: 'Ultimos 7 dias', icon: Calendar01Icon },
];

// --- Component ---

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [movements, setMovements] = useState<RecentMovement[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-6">
      <DashboardHeader userName={user?.name} />

      {/* KPI Cards */}
      <div data-testid="kpi-cards" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
          : kpiCards.map((kpi) => (
              <KpiCard
                key={kpi.key}
                label={kpi.label}
                value={stats?.[kpi.key] ?? 0}
                description={kpi.description}
                icon={kpi.icon}
                isWarning={kpi.isWarning}
              />
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
                            <div className="font-medium">{mov.product_name}</div>
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
                  className="text-sm text-primary hover:underline"
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

function KpiCard({
  label,
  value,
  description,
  icon,
  isWarning,
}: {
  label: string;
  value: number;
  description: string;
  icon: typeof Package01Icon;
  isWarning?: boolean;
}) {
  return (
    <Card size="sm">
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
        <p className={cn(
          'text-2xl font-bold',
          isWarning && value > 0 && 'text-amber-600 dark:text-amber-400'
        )}>
          {value.toLocaleString('es-MX')}
        </p>
        <p className="text-muted-foreground text-xs mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-4 rounded-full" />
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
