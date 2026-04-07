'use client'

import { Card, CardContent } from '@/components/ui/card'
import { SEVERITY_CONFIG } from '@/lib/severity'
import type { ZoneHealth } from '@/types'
import { cn } from '@/lib/utils'

interface ZoneCardProps {
  zone: ZoneHealth
  selected?: boolean
  onClick?: (zone: ZoneHealth) => void
}

export function ZoneCard({ zone, selected, onClick }: ZoneCardProps) {
  const config = SEVERITY_CONFIG[zone.severity]
  const total = zone.total_items
  const problemCount = zone.critical_count + zone.low_count + zone.warning_count

  // Proportional bar segments
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  // Occupation: how many sub-locations have stock vs total
  const occupiedCount = zone.ok_count + zone.critical_count + zone.low_count + zone.warning_count
  const occupationPct =
    zone.child_location_count > 0
      ? Math.round((occupiedCount / zone.child_location_count) * 100)
      : 0

  return (
    <Card
      className={cn(
        'overflow-hidden transition-all duration-200 hover:shadow-md',
        onClick && 'cursor-pointer',
        selected
          ? 'ring-2 ring-primary shadow-md scale-[1.02]'
          : 'ring-0 scale-100',
      )}
      onClick={() => onClick?.(zone)}
    >
      {/* Top severity bar */}
      {total > 0 ? (
        <div className="flex h-1.5">
          {zone.critical_count > 0 && (
            <div className="bg-red-500" style={{ width: `${pct(zone.critical_count)}%` }} />
          )}
          {zone.low_count > 0 && (
            <div className="bg-orange-500" style={{ width: `${pct(zone.low_count)}%` }} />
          )}
          {zone.warning_count > 0 && (
            <div className="bg-amber-400" style={{ width: `${pct(zone.warning_count)}%` }} />
          )}
          {zone.ok_count > 0 && (
            <div className="bg-green-500" style={{ width: `${pct(zone.ok_count)}%` }} />
          )}
        </div>
      ) : (
        <div className="h-1.5 bg-muted" />
      )}

      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm truncate">{zone.zone_name}</h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config.bg} ${config.text}`}
          >
            {config.label}
          </span>
        </div>

        {/* Stats */}
        <p className="text-xs text-muted-foreground">
          {total} producto{total !== 1 ? 's' : ''} en {zone.child_location_count} ubicacion
          {zone.child_location_count !== 1 ? 'es' : ''}
        </p>

        {/* Occupation bar */}
        {zone.child_location_count > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Ocupacion</span>
              <span>{occupationPct}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  occupationPct === 0
                    ? 'bg-muted-foreground/30'
                    : occupationPct < 50
                      ? 'bg-amber-400'
                      : 'bg-green-500',
                )}
                style={{ width: `${occupationPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Breakdown counts */}
        {total > 0 && problemCount > 0 && (
          <div className="flex gap-3 text-xs">
            {zone.critical_count > 0 && (
              <span className="text-red-600 dark:text-red-400 font-medium">
                {zone.critical_count} criticos
              </span>
            )}
            {zone.low_count > 0 && (
              <span className="text-orange-600 dark:text-orange-400 font-medium">
                {zone.low_count} bajos
              </span>
            )}
            {zone.warning_count > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {zone.warning_count} alertas
              </span>
            )}
          </div>
        )}

        {total === 0 && (
          <p className="text-xs text-muted-foreground italic">Sin inventario</p>
        )}
      </CardContent>
    </Card>
  )
}
