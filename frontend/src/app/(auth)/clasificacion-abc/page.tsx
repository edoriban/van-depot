'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type { AbcReport } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PERIOD_OPTIONS = [
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' },
];

const CLASSIFICATION_STYLES: Record<string, { badge: 'default' | 'secondary' | 'outline'; bg: string; text: string; bar: string; label: string }> = {
  A: { badge: 'default', bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-400', bar: 'bg-green-500', label: 'Alta prioridad' },
  B: { badge: 'secondary', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-500', label: 'Media prioridad' },
  C: { badge: 'outline', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500', label: 'Baja prioridad' },
};

export default function ClasificacionAbcPage() {
  const [report, setReport] = useState<AbcReport | null>(null);
  const [period, setPeriod] = useState('90');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (periodDays: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<AbcReport>(`/reports/abc-classification?period=${periodDays}`);
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la clasificacion ABC');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(period);
  }, [period, fetchReport]);

  const handlePeriodChange = (value: string) => {
    setPeriod(value);
  };

  return (
    <div className="space-y-6" data-testid="abc-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clasificacion ABC</h1>
          <p className="text-muted-foreground mt-1 max-w-xl">
            La clasificacion ABC identifica tus productos mas importantes basandose en la frecuencia de movimientos. Los productos &apos;A&apos; son los que mas se mueven y merecen mayor atencion.
          </p>
        </div>
        <Select
          value={period}
          onValueChange={handlePeriodChange}
        >
          <SelectTrigger data-testid="period-selector" className="w-40">
            <SelectValue placeholder="Seleccionar periodo" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {report && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="abc-summary-cards">
          {/* A Card */}
          <Card className={CLASSIFICATION_STYLES.A.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.A.text}>
                Alta prioridad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.A.text}`}>
                  {report.summary.a_count}
                </span>
                <span className="text-muted-foreground text-sm">productos</span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {report.summary.a_movement_percentage.toFixed(1)}% de movimientos
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Tus productos estrella — controla su stock de cerca
              </p>
            </CardContent>
          </Card>

          {/* B Card */}
          <Card className={CLASSIFICATION_STYLES.B.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.B.text}>
                Media prioridad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.B.text}`}>
                  {report.summary.b_count}
                </span>
                <span className="text-muted-foreground text-sm">productos</span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {report.summary.b_movement_percentage.toFixed(1)}% de movimientos
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Productos de uso regular
              </p>
            </CardContent>
          </Card>

          {/* C Card */}
          <Card className={CLASSIFICATION_STYLES.C.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.C.text}>
                Baja prioridad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.C.text}`}>
                  {report.summary.c_count}
                </span>
                <span className="text-muted-foreground text-sm">productos</span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {report.summary.c_movement_percentage.toFixed(1)}% de movimientos
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Productos de bajo movimiento — revisa si siguen siendo necesarios
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pareto Bar Chart (CSS-based) */}
      {report && report.items.length > 0 && (
        <Card data-testid="abc-pareto-chart">
          <CardHeader>
            <CardTitle>Distribucion de Pareto</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {report.items.map((item) => {
                const maxCount = report.items[0]?.movement_count || 1;
                const heightPct = (item.movement_count / maxCount) * 100;
                const style = CLASSIFICATION_STYLES[item.classification] || CLASSIFICATION_STYLES.C;
                return (
                  <div
                    key={item.product_id}
                    className={`${style.bar} rounded-t min-w-1 flex-1 transition-all`}
                    style={{ height: `${heightPct}%` }}
                    title={`${item.product_name} (${item.product_sku}): ${item.movement_count} movimientos`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-green-500" />
                <span>A ({report.summary.a_count})</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-blue-500" />
                <span>B ({report.summary.b_count})</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-amber-500" />
                <span>C ({report.summary.c_count})</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card data-testid="abc-table">
        <CardHeader>
          <CardTitle>Detalle por producto</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Cargando...
            </div>
          ) : report && report.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Producto</th>
                    <th className="pb-3 pr-4 font-medium text-right">Movimientos</th>
                    <th className="pb-3 pr-4 font-medium text-right">Cantidad total</th>
                    <th className="pb-3 pr-4 font-medium text-center">Clasificacion</th>
                    <th className="pb-3 font-medium text-right">% Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => {
                    const style = CLASSIFICATION_STYLES[item.classification] || CLASSIFICATION_STYLES.C;
                    return (
                      <tr key={item.product_id} className="border-b last:border-0">
                        <td className="py-3 pr-4">
                          <div className="font-medium">{item.product_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{item.product_sku}</div>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">{item.movement_count}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{item.total_quantity.toFixed(1)}</td>
                        <td className="py-3 pr-4 text-center">
                          <Badge variant={style.badge} className={style.text}>
                            {style.label}
                          </Badge>
                        </td>
                        <td className="py-3 text-right tabular-nums">{item.cumulative_percentage.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No hay movimientos en el periodo seleccionado
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
