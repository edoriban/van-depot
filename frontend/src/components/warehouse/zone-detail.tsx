'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SEVERITY_CONFIG } from '@/lib/severity'
import type { ZoneHealth, Location, InventoryItem, PaginatedResponse, ZoneSeverity } from '@/types'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, ClipboardIcon, ArrowDataTransferHorizontalIcon, ArrowDown01Icon } from '@hugeicons/core-free-icons'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const LOCATION_TYPE_LABELS: Record<string, string> = {
  zone: 'Zona',
  rack: 'Rack',
  shelf: 'Estante',
  position: 'Posicion',
  bin: 'Contenedor',
}

/** Compute severity for a sub-location based on its inventory items */
function computeSubLocationSeverity(
  items: InventoryItem[],
  fallbackSeverity: ZoneSeverity,
): ZoneSeverity {
  if (items.length === 0) return fallbackSeverity
  const hasCritical = items.some((i) => i.quantity === 0 && i.min_stock > 0)
  if (hasCritical) return 'critical'
  const hasLow = items.some((i) => i.quantity > 0 && i.quantity <= i.min_stock)
  if (hasLow) return 'low'
  const hasWarning = items.some(
    (i) => i.min_stock > 0 && i.quantity <= i.min_stock * 1.5 && i.quantity > i.min_stock,
  )
  if (hasWarning) return 'warning'
  return 'ok'
}

function StockBadge({ quantity, minStock }: { quantity: number; minStock: number }) {
  if (quantity === 0 && minStock > 0) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-[10px]">
        Critico
      </Badge>
    )
  }
  if (quantity <= minStock && minStock > 0) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-[10px]">
        Bajo
      </Badge>
    )
  }
  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-[10px]">
      OK
    </Badge>
  )
}

function SubLocationSeverityDot({ severity }: { severity: ZoneSeverity }) {
  const config = SEVERITY_CONFIG[severity]
  return <span className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />
}

function SubLocationRow({
  loc,
  zoneSeverity,
}: {
  loc: Location
  zoneSeverity: ZoneSeverity
}) {
  const [expanded, setExpanded] = useState(false)

  // Fetch inventory for this specific sub-location
  const { data: inventoryData, isLoading: inventoryLoading } = useSWR<InventoryItem[]>(
    expanded ? `/inventory/location/${loc.id}` : null,
  )

  const items = inventoryData ?? []
  const severity = expanded ? computeSubLocationSeverity(items, zoneSeverity) : zoneSeverity

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <SubLocationSeverityDot severity={severity} />
          <span className="text-sm font-medium truncate">{loc.name}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {LOCATION_TYPE_LABELS[loc.location_type] ?? loc.location_type}
          </Badge>
        </div>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expandable inventory section */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="px-3 pb-3 pl-7">
          {inventoryLoading ? (
            <div className="space-y-1.5 py-1">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">Sin inventario</p>
          ) : (
            <div className="space-y-1 py-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{item.product_name}</span>
                    <span className="text-muted-foreground font-mono shrink-0">
                      {item.product_sku}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-medium tabular-nums">{item.quantity}</span>
                    <StockBadge quantity={item.quantity} minStock={item.min_stock} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ZoneDetailProps {
  zone: ZoneHealth
  warehouseId: string
  onClose: () => void
}

export function ZoneDetail({ zone, warehouseId, onClose }: ZoneDetailProps) {
  const { data, isLoading, error } = useSWR<PaginatedResponse<Location>>(
    `/warehouses/${warehouseId}/locations?parent_id=${zone.zone_id}&per_page=50`,
  )

  // Fetch zone-level inventory for the summary
  const { data: zoneInventory, isLoading: zoneInventoryLoading } = useSWR<InventoryItem[]>(
    `/inventory/location/${zone.zone_id}`,
  )

  const subLocations = data?.data ?? []
  const zoneItems = zoneInventory ?? []

  return (
    <Card
      className={cn(
        'transition-all duration-300 ease-out',
        'w-full',
      )}
      data-testid="zone-detail"
    >
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0"
          data-testid="zone-detail-close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary line */}
        <p className="text-sm text-muted-foreground">
          {zone.child_location_count} sub-ubicaciones -- {zone.total_items} productos
        </p>

        {/* Zone-level inventory summary */}
        {zoneInventoryLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : zoneItems.length > 0 ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Inventario en zona
            </p>
            {zoneItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{item.product_name}</span>
                  <span className="text-muted-foreground font-mono shrink-0">
                    {item.product_sku}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium tabular-nums">{item.quantity}</span>
                  <StockBadge quantity={item.quantity} minStock={item.min_stock} />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Sub-locations list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Error al cargar sub-ubicaciones</p>
        ) : subLocations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Sin sub-ubicaciones registradas
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {subLocations.map((loc) => (
              <SubLocationRow key={loc.id} loc={loc} zoneSeverity={zone.severity} />
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
            <Link href="/movimientos">
              <HugeiconsIcon
                icon={ArrowDataTransferHorizontalIcon}
                size={14}
                className="mr-1.5"
              />
              Registrar movimiento
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
