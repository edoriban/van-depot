'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-mutations';
import type { AbcReport, AbcItem } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

const PERIOD_OPTIONS = [
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' },
];

const CLASSIFICATION_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#3b82f6',
  C: '#f59e0b',
};

const CLASSIFICATION_STYLES: Record<
  string,
  {
    badge: 'default' | 'secondary' | 'outline';
    bg: string;
    rowBg: string;
    text: string;
    bar: string;
    label: string;
  }
> = {
  A: {
    badge: 'default',
    bg: 'bg-green-50 dark:bg-green-950/30',
    rowBg: 'bg-emerald-500/5',
    text: 'text-green-700 dark:text-green-400',
    bar: 'bg-green-500',
    label: 'Alta prioridad',
  },
  B: {
    badge: 'secondary',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    rowBg: 'bg-blue-500/5',
    text: 'text-blue-700 dark:text-blue-400',
    bar: 'bg-blue-500',
    label: 'Media prioridad',
  },
  C: {
    badge: 'outline',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    rowBg: 'bg-amber-500/5',
    text: 'text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500',
    label: 'Baja prioridad',
  },
};

type SortField = 'movement_count' | 'total_quantity' | 'cumulative_percentage';
type SortDir = 'asc' | 'desc';

function getRiskBadge(item: AbcItem): { label: string; variant: 'default' | 'secondary' | 'outline'; className: string } | null {
  const pct = item.cumulative_percentage;

  if (pct >= 75 && pct <= 85) {
    return { label: 'Limite A/B', variant: 'outline', className: 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400' };
  }
  if (pct >= 90 && pct <= 97) {
    return { label: 'Limite B/C', variant: 'outline', className: 'border-blue-500/50 text-blue-700 dark:text-blue-400' };
  }
  if (item.classification === 'A' && pct >= 70) {
    return { label: 'Monitorear', variant: 'outline', className: 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400' };
  }
  if (item.classification === 'C' && pct <= 97) {
    return { label: 'En ascenso', variant: 'outline', className: 'border-blue-500/50 text-blue-700 dark:text-blue-400' };
  }
  return null;
}

// --- Mini donut for summary cards ---
function MiniDonut({ value, total, color }: { value: number; total: number; color: string }) {
  const data = [
    { name: 'value', v: value },
    { name: 'rest', v: Math.max(total - value, 0) },
  ];
  return (
    <PieChart width={80} height={80}>
      <Pie
        data={data}
        cx={40}
        cy={40}
        innerRadius={24}
        outerRadius={36}
        dataKey="v"
        startAngle={90}
        endAngle={-270}
        strokeWidth={0}
      >
        <Cell fill={color} />
        <Cell fill="hsl(var(--muted))" />
      </Pie>
    </PieChart>
  );
}

// --- Custom Pareto tooltip ---
function ParetoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; sku: string; movimientos: number; cantidad: number; acumulado: number; classification: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover p-3 text-sm shadow-md">
      <p className="font-semibold">{d.name}</p>
      <p className="text-xs text-muted-foreground font-mono">{d.sku}</p>
      <div className="mt-1.5 space-y-0.5 text-xs">
        <p>Movimientos: <span className="font-medium">{d.movimientos}</span></p>
        <p>Cantidad: <span className="font-medium">{d.cantidad.toFixed(1)}</span></p>
        <p>% Acumulado: <span className="font-medium">{d.acumulado.toFixed(1)}%</span></p>
      </div>
    </div>
  );
}

const PAGE_SIZE = 25;

export default function ClasificacionAbcPage() {
  const [report, setReport] = useState<AbcReport | null>(null);
  const [period, setPeriod] = useState('90');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table state
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('movement_count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

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

  // Reset page on search/sort change
  useEffect(() => {
    setPage(1);
  }, [search, sortField, sortDir]);

  const handlePeriodChange = (value: string) => {
    setPeriod(value);
    setPage(1);
    setSearch('');
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Pareto chart data (top 30)
  const paretoData = useMemo(() => {
    if (!report) return [];
    return report.items.slice(0, 30).map((item) => ({
      name: item.product_name.length > 18 ? item.product_name.slice(0, 18) + '...' : item.product_name,
      fullName: item.product_name,
      sku: item.product_sku,
      movimientos: item.movement_count,
      cantidad: item.total_quantity,
      acumulado: item.cumulative_percentage,
      classification: item.classification,
    }));
  }, [report]);

  // Filtered + sorted + paginated items
  const { pageItems, totalPages, totalFiltered } = useMemo(() => {
    if (!report) return { pageItems: [] as AbcItem[], totalPages: 0, totalFiltered: 0 };
    const q = search.toLowerCase().trim();
    let filtered = report.items;
    if (q) {
      filtered = filtered.filter(
        (i) => i.product_name.toLowerCase().includes(q) || i.product_sku.toLowerCase().includes(q),
      );
    }
    const sorted = filtered.toSorted((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      return (a[sortField] - b[sortField]) * mul;
    });
    const tp = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    return { pageItems: sorted.slice(start, start + PAGE_SIZE), totalPages: tp, totalFiltered: sorted.length };
  }, [report, search, sortField, sortDir, page]);

  const totalProducts = report ? report.summary.a_count + report.summary.b_count + report.summary.c_count : 0;

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="space-y-6" data-testid="abc-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clasificacion ABC</h1>
          <p className="text-muted-foreground mt-1 max-w-xl">
            La clasificacion ABC identifica tus productos mas importantes basandose en la frecuencia de movimientos. Los productos &apos;A&apos; son los que mas se mueven y merecen mayor atencion.
          </p>
        </div>
        <Select value={period} onValueChange={handlePeriodChange}>
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

      {/* Summary Cards with Donut Charts */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {['sk-a', 'sk-b', 'sk-c'].map((id) => (
            <Card key={id}>
              <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
              <CardContent className="flex items-center gap-4">
                <Skeleton className="size-20 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : report ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="abc-summary-cards">
          {/* A Card */}
          <Card className={CLASSIFICATION_STYLES.A.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.A.text}>Alta prioridad</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <MiniDonut value={report.summary.a_count} total={totalProducts} color={CLASSIFICATION_COLORS.A} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.A.text}`}>
                      {report.summary.a_count}
                    </span>
                    <span className="text-muted-foreground text-sm">productos</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {report.summary.a_movement_percentage.toFixed(1)}% de movimientos
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Tus productos estrella: controla su stock de cerca
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* B Card */}
          <Card className={CLASSIFICATION_STYLES.B.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.B.text}>Media prioridad</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <MiniDonut value={report.summary.b_count} total={totalProducts} color={CLASSIFICATION_COLORS.B} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.B.text}`}>
                      {report.summary.b_count}
                    </span>
                    <span className="text-muted-foreground text-sm">productos</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {report.summary.b_movement_percentage.toFixed(1)}% de movimientos
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Productos de uso regular
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* C Card */}
          <Card className={CLASSIFICATION_STYLES.C.bg}>
            <CardHeader>
              <CardTitle className={CLASSIFICATION_STYLES.C.text}>Baja prioridad</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <MiniDonut value={report.summary.c_count} total={totalProducts} color={CLASSIFICATION_COLORS.C} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${CLASSIFICATION_STYLES.C.text}`}>
                      {report.summary.c_count}
                    </span>
                    <span className="text-muted-foreground text-sm">productos</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {report.summary.c_movement_percentage.toFixed(1)}% de movimientos
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Productos de bajo movimiento: revisa si siguen siendo necesarios
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Pareto Chart (Recharts) */}
      {isLoading ? (
        <Card>
          <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
          <CardContent><Skeleton className="h-[320px] w-full" /></CardContent>
        </Card>
      ) : report && report.items.length > 0 ? (
        <Card data-testid="abc-pareto-chart">
          <CardHeader>
            <CardTitle>Analisis Pareto</CardTitle>
            <p className="text-sm text-muted-foreground">
              Top 30 productos por movimientos. Las barras muestran movimientos y la linea el % acumulado.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={paretoData} margin={{ top: 10, right: 20, bottom: 60, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  height={80}
                  className="fill-muted-foreground"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  label={{ value: 'Movimientos', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  label={{ value: '% Acumulado', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ParetoTooltip />} />
                <Legend verticalAlign="top" />
                <ReferenceLine yAxisId="right" y={80} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: '80%', position: 'right', fill: '#f59e0b', fontSize: 11 }} />
                <ReferenceLine yAxisId="right" y={95} stroke="#ef4444" strokeDasharray="6 3" label={{ value: '95%', position: 'right', fill: '#ef4444', fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="movimientos" name="Movimientos" radius={[3, 3, 0, 0]}>
                  {paretoData.map((entry) => (
                    <Cell key={entry.sku} fill={CLASSIFICATION_COLORS[entry.classification] || CLASSIFICATION_COLORS.C} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="acumulado"
                  name="% Acumulado"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="size-3 rounded bg-green-500" />
                <span>A ({report.summary.a_count})</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-3 rounded bg-blue-500" />
                <span>B ({report.summary.b_count})</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-3 rounded bg-amber-500" />
                <span>C ({report.summary.c_count})</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Detail Table */}
      <Card data-testid="abc-table">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Detalle por producto</CardTitle>
            {report && (
              <Input
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : report && report.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Producto</th>
                      <th
                        className="pb-3 pr-4 font-medium text-right cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort('movement_count')}
                      >
                        Movimientos{sortIcon('movement_count')}
                      </th>
                      <th
                        className="pb-3 pr-4 font-medium text-right cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort('total_quantity')}
                      >
                        Cantidad total{sortIcon('total_quantity')}
                      </th>
                      <th className="pb-3 pr-4 font-medium text-center">Clasificacion</th>
                      <th
                        className="pb-3 pr-4 font-medium text-right cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort('cumulative_percentage')}
                      >
                        % Acumulado{sortIcon('cumulative_percentage')}
                      </th>
                      <th className="pb-3 font-medium text-center">Riesgo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => {
                      const style = CLASSIFICATION_STYLES[item.classification] || CLASSIFICATION_STYLES.C;
                      const risk = getRiskBadge(item);
                      return (
                        <tr key={item.product_id} className={`border-b last:border-0 ${style.rowBg}`}>
                          <td className="py-3 pr-4">
                            <Link
                              href={`/productos/${item.product_id}`}
                              className="font-medium hover:underline hover:text-primary transition-colors"
                            >
                              {item.product_name}
                            </Link>
                            <div className="text-xs text-muted-foreground font-mono">{item.product_sku}</div>
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">{item.movement_count}</td>
                          <td className="py-3 pr-4 text-right tabular-nums">{item.total_quantity.toFixed(1)}</td>
                          <td className="py-3 pr-4 text-center">
                            <Badge variant={style.badge} className={style.text}>
                              {style.label}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2 justify-end">
                              <div className="hidden sm:block h-2 w-20 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(item.cumulative_percentage, 100)}%`,
                                    backgroundColor: CLASSIFICATION_COLORS[item.classification] || CLASSIFICATION_COLORS.C,
                                  }}
                                />
                              </div>
                              <span className="tabular-nums text-right min-w-[3.5rem]">
                                {item.cumulative_percentage.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3 text-center">
                            {risk ? (
                              <Badge variant={risk.variant} className={risk.className}>
                                {risk.label}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {totalFiltered} producto{totalFiltered !== 1 ? 's' : ''}
                  {search && ` encontrado${totalFiltered !== 1 ? 's' : ''}`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Anterior
                  </button>
                  <span className="text-xs tabular-nums">
                    Pagina {page} de {totalPages}
                  </span>
                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </>
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
