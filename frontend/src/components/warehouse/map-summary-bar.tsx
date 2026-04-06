'use client';

import { SEVERITY_CONFIG } from '@/lib/severity';
import type { WarehouseMapResponse, ZoneSeverity } from '@/types';

export function MapSummaryBar({ summary }: { summary: WarehouseMapResponse['summary'] }) {
  const items: { key: ZoneSeverity; count: number }[] = [
    { key: 'critical', count: summary.critical_zones },
    { key: 'low', count: summary.low_zones },
    { key: 'warning', count: summary.warning_zones },
    { key: 'ok', count: summary.ok_zones },
    { key: 'empty', count: summary.empty_zones },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {items.map(({ key, count }) => {
        const config = SEVERITY_CONFIG[key];
        return (
          <div
            key={key}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${config.bg} ${config.text}`}
          >
            <div className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
            <span className="font-medium">{count}</span>
            <span>{config.label}</span>
          </div>
        );
      })}
    </div>
  );
}
