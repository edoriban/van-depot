'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api-mutations';
import type { StockAlert, AlertSummary, Warehouse } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

// ── Severity config ─────────────────────────────────────────────────

const severityConfig: Record<string, { label: string; className: string; order: number }> = {
  critical: { label: 'Critico', className: 'bg-red-500/15 text-red-700 dark:text-red-400', order: 0 },
  low: { label: 'Bajo', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', order: 1 },
  warning: { label: 'Advertencia', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400', order: 2 },
};

// ── Component ───────────────────────────────────────────────────────

export default function AlertasPage() {
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);

        const [alertsRes, summaryRes, warehousesRes] = await Promise.all([
          api.get<StockAlert[]>('/alerts/stock'),
          api.get<AlertSummary>('/alerts/summary'),
          api.get<{ data: Warehouse[] }>('/warehouses'),
        ]);

        setAlerts(alertsRes);
        setSummary(summaryRes);
        setWarehouses(warehousesRes.data ?? warehousesRes as unknown as Warehouse[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar alertas');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const filteredAlerts = useMemo(() => {
    let result = [...alerts];

    if (warehouseFilter !== 'all') {
      result = result.filter((a) => a.warehouse_id === warehouseFilter);
    }

    if (severityFilter !== 'all') {
      result = result.filter((a) => a.severity === severityFilter);
    }

    // Sort by severity (critical first)
    result.sort((a, b) => {
      const orderA = severityConfig[a.severity]?.order ?? 99;
      const orderB = severityConfig[b.severity]?.order ?? 99;
      return orderA - orderB;
    });

    return result;
  }, [alerts, warehouseFilter, severityFilter]);

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader summary={null} />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive font-medium">Error al cargar alertas</p>
            <p className="text-muted-foreground text-sm mt-1">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="alertas-page">
      <PageHeader summary={summary} />

      {/* Filters */}
      <div className="flex flex-wrap gap-4" data-testid="alertas-filters">
        <Select
          value={warehouseFilter}
          onValueChange={setWarehouseFilter}
        >
          <SelectTrigger data-testid="filter-warehouse" className="w-[220px]">
            <SelectValue placeholder="Todos los almacenes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los almacenes</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={severityFilter}
          onValueChange={setSeverityFilter}
        >
          <SelectTrigger data-testid="filter-severity" className="w-[200px]">
            <SelectValue placeholder="Todas las severidades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las severidades</SelectItem>
            <SelectItem value="critical">Critico</SelectItem>
            <SelectItem value="low">Bajo</SelectItem>
            <SelectItem value="warning">Advertencia</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Alerts Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <AlertsSkeleton />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No hay alertas de stock
            </p>
          ) : (
            <Table data-testid="alertas-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Severidad</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Ubicacion</TableHead>
                  <TableHead>Almacen</TableHead>
                  <TableHead className="text-right">Cantidad actual</TableHead>
                  <TableHead className="text-right">Stock min</TableHead>
                  <TableHead className="text-right">Deficit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((alert) => {
                  const config = severityConfig[alert.severity];
                  return (
                    <TableRow key={`${alert.product_id}-${alert.location_id}`} data-testid="alert-row">
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('border-0', config?.className)}
                          data-testid="severity-badge"
                        >
                          {config?.label ?? alert.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{alert.product_name}</div>
                        <div className="text-muted-foreground text-xs">{alert.product_sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{alert.location_name}</TableCell>
                      <TableCell className="text-sm">{alert.warehouse_name}</TableCell>
                      <TableCell className="text-right font-medium">
                        {alert.current_quantity}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {alert.min_stock}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          'font-semibold',
                          alert.severity === 'critical' ? 'text-red-600 dark:text-red-400' :
                          alert.severity === 'low' ? 'text-amber-600 dark:text-amber-400' :
                          'text-yellow-600 dark:text-yellow-400'
                        )}>
                          {alert.deficit}
                        </span>
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
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function PageHeader({ summary }: { summary: AlertSummary | null }) {
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="alertas-header">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Alert02Icon} size={24} className="text-amber-500" />
        <h1 className="text-2xl font-bold">Alertas de Stock</h1>
      </div>
      {summary && (
        <div className="flex gap-2" data-testid="alert-summary-badges">
          {summary.critical_count > 0 && (
            <Badge variant="outline" className="border-0 bg-red-500/15 text-red-700 dark:text-red-400" data-testid="badge-critical">
              {summary.critical_count} criticos
            </Badge>
          )}
          {summary.low_count > 0 && (
            <Badge variant="outline" className="border-0 bg-amber-500/15 text-amber-700 dark:text-amber-400" data-testid="badge-low">
              {summary.low_count} bajos
            </Badge>
          )}
          {summary.warning_count > 0 && (
            <Badge variant="outline" className="border-0 bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" data-testid="badge-warning">
              {summary.warning_count} advertencias
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function AlertsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-12 ml-auto" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
