/**
 * components/almacenes/warehouse-summary-stats.tsx — 4-cell summary bar
 * (Almacenes / Ubicaciones / Productos / Criticos) shown above the search
 * input on `/almacenes`.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 (Migration pattern) and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-1.
 *
 * Presentational. Receives derived totals as props — does NOT compute
 * anything itself. The red-highlight branch for `totalCritical > 0` is
 * preserved verbatim from the legacy page.
 */
'use client';

interface SummaryStats {
  totalLocations: number;
  totalProducts: number;
  totalCritical: number;
  totalLow: number;
}

interface WarehouseSummaryStatsProps {
  summaryStats: SummaryStats;
  warehousesCount: number;
}

export function WarehouseSummaryStats({
  summaryStats,
  warehousesCount,
}: WarehouseSummaryStatsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="rounded-lg border bg-card p-3 text-center">
        <p className="text-2xl font-bold">{warehousesCount}</p>
        <p className="text-xs text-muted-foreground">Almacenes</p>
      </div>
      <div className="rounded-lg border bg-card p-3 text-center">
        <p className="text-2xl font-bold">{summaryStats.totalLocations}</p>
        <p className="text-xs text-muted-foreground">Ubicaciones</p>
      </div>
      <div className="rounded-lg border bg-card p-3 text-center">
        <p className="text-2xl font-bold">{summaryStats.totalProducts}</p>
        <p className="text-xs text-muted-foreground">Productos</p>
      </div>
      {summaryStats.totalCritical > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3 text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {summaryStats.totalCritical}
          </p>
          <p className="text-xs text-red-600 dark:text-red-400">Criticos</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            0
          </p>
          <p className="text-xs text-muted-foreground">Criticos</p>
        </div>
      )}
    </div>
  );
}
