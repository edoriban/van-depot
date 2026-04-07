'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useMapStore } from '@/stores/map-store'
import { MapSearch } from '@/components/warehouse/map-search'
import { SEVERITY_CONFIG } from '@/lib/severity'
import { SEVERITY_HEX } from '@/lib/severity-colors'
import type { ZoneSeverity } from '@/types'

const ALL_SEVERITIES: ZoneSeverity[] = ['critical', 'low', 'warning', 'ok', 'empty']

interface MapToolbarProps {
  warehouseId: string
  onZoomIn: () => void
  onZoomOut: () => void
  onFitToScreen: () => void
  onResetLayout: () => void
  onSaveLayout: () => void
  onNavigateToZone: (zoneId: string) => void
  hasPendingChanges: boolean
  isSaving: boolean
}

export function MapToolbar({
  warehouseId,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetLayout,
  onSaveLayout,
  onNavigateToZone,
  hasPendingChanges,
  isSaving,
}: MapToolbarProps) {
  const {
    zoom,
    editMode,
    heatMap,
    severityFilters,
    toggleEditMode,
    toggleHeatMap,
    toggleSeverityFilter,
  } = useMapStore()

  const zoomPct = `${Math.round(zoom * 100)}%`

  return (
    <div className="space-y-2" data-testid="map-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onZoomOut}
            aria-label="Alejar"
          >
            -
          </Button>
          <span className="w-12 text-center text-xs font-medium tabular-nums">
            {zoomPct}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onZoomIn}
            aria-label="Acercar"
          >
            +
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onFitToScreen}
        >
          Ajustar
        </Button>

        <div className="h-5 w-px bg-border" />

        {/* T22: Search */}
        <MapSearch
          warehouseId={warehouseId}
          onNavigateToZone={onNavigateToZone}
        />

        <div className="h-5 w-px bg-border" />

        {/* Edit mode toggle */}
        <Button
          variant={editMode ? 'default' : 'outline'}
          size="sm"
          onClick={toggleEditMode}
          data-testid="toggle-edit-mode"
        >
          {editMode ? 'Editando' : 'Editar layout'}
        </Button>

        {/* Heat map toggle */}
        <Button
          variant={heatMap ? 'default' : 'outline'}
          size="sm"
          onClick={toggleHeatMap}
          data-testid="toggle-heat-map"
        >
          Heat Map
        </Button>

        {/* Edit mode actions */}
        {editMode && (
          <>
            <div className="h-5 w-px bg-border" />

            <Button
              variant="outline"
              size="sm"
              onClick={onResetLayout}
            >
              Restaurar auto-layout
            </Button>

            {hasPendingChanges && (
              <Button
                size="sm"
                onClick={onSaveLayout}
                disabled={isSaving}
                data-testid="save-layout-btn"
              >
                {isSaving ? 'Guardando...' : 'Guardar layout'}
              </Button>
            )}

            {hasPendingChanges && (
              <Badge variant="secondary" className="text-xs">
                Cambios sin guardar
              </Badge>
            )}
          </>
        )}
      </div>

      {/* T23: Severity filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Filtros:</span>
        {ALL_SEVERITIES.map((sev) => {
          const isActive =
            severityFilters.size === 0 || severityFilters.has(sev)
          const config = SEVERITY_CONFIG[sev]
          const colors = SEVERITY_HEX[sev]

          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverityFilter(sev)}
              className={`
                inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5
                text-xs font-medium transition-all
                ${
                  isActive
                    ? 'border-transparent shadow-sm'
                    : 'border-border opacity-40 grayscale'
                }
              `}
              style={{
                backgroundColor: isActive ? colors.fill : undefined,
                color: isActive ? colors.text : undefined,
              }}
              data-testid={`severity-filter-${sev}`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: colors.stroke }}
              />
              {config.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
