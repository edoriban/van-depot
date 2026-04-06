'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SEVERITY_CONFIG } from '@/lib/severity'
import type { ZoneHealth, Location, PaginatedResponse, ZoneSeverity } from '@/types'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, ClipboardIcon, ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons'
import Link from 'next/link'

const LOCATION_TYPE_LABELS: Record<string, string> = {
  zone: 'Zona',
  rack: 'Rack',
  shelf: 'Estante',
  position: 'Posicion',
  bin: 'Contenedor',
}

function SubLocationSeverityDot({ severity }: { severity: ZoneSeverity }) {
  const config = SEVERITY_CONFIG[severity]
  return <span className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />
}

interface ZoneDetailProps {
  zone: ZoneHealth
  warehouseId: string
  onClose: () => void
}

export function ZoneDetail({ zone, warehouseId, onClose }: ZoneDetailProps) {
  const { data, isLoading, error } = useSWR<PaginatedResponse<Location>>(
    `/warehouses/${warehouseId}/locations?parent_id=${zone.zone_id}&per_page=50`
  )

  const subLocations = data?.data ?? []

  return (
    <Card className="animate-in fade-in-0 slide-in-from-top-2 duration-200" data-testid="zone-detail">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <CardTitle className="text-base truncate">{zone.zone_name}</CardTitle>
          <Badge
            className={`shrink-0 ${SEVERITY_CONFIG[zone.severity].bg} ${SEVERITY_CONFIG[zone.severity].text}`}
            variant="secondary"
          >
            {SEVERITY_CONFIG[zone.severity].label}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0" data-testid="zone-detail-close">
          <HugeiconsIcon icon={Cancel01Icon} size={18} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary line */}
        <p className="text-sm text-muted-foreground">
          {zone.child_location_count} sub-ubicaciones -- {zone.total_items} productos
        </p>

        {/* Sub-locations list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Error al cargar sub-ubicaciones</p>
        ) : subLocations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Sin sub-ubicaciones registradas</p>
        ) : (
          <div className="divide-y rounded-md border">
            {subLocations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <SubLocationSeverityDot severity="ok" />
                  <span className="text-sm font-medium truncate">{loc.name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {LOCATION_TYPE_LABELS[loc.location_type] ?? loc.location_type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/almacenes/${warehouseId}?tab=inventario`}>
              <HugeiconsIcon icon={ClipboardIcon} size={14} className="mr-1.5" />
              Ver inventario
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/movements">
              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={14} className="mr-1.5" />
              Registrar movimiento
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
