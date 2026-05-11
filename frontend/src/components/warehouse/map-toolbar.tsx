'use client'

import { useState } from 'react'
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

  // T29: Mobile search toggle
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  // T29: Mobile filters toggle
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const zoomPct = `${Math.round(zoom * 100)}%`

  const activeFilterCount = severityFilters.size

  return (
    <div className="space-y-2" data-testid="map-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
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
            className="size-7 p-0"
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
          aria-label="Ajustar"
        >
          {/* T29: Icon-only on mobile, text on md+ */}
          <span className="md:hidden" aria-hidden="true">&#8596;</span>
          <span className="hidden md:inline">Ajustar</span>
        </Button>

        <div className="h-5 w-px bg-border hidden md:block" />

        {/* T22/T29: Search — inline on desktop, toggle button on mobile */}
        <div className="hidden md:block">
          <MapSearch
            warehouseId={warehouseId}
            onNavigateToZone={onNavigateToZone}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
          aria-label="Buscar"
        >
          &#128269;
        </Button>

        <div className="h-5 w-px bg-border hidden md:block" />

        {/* Edit mode toggle — T29: icon on mobile */}
        <Button
          variant={editMode ? 'default' : 'outline'}
          size="sm"
          onClick={toggleEditMode}
          data-testid="toggle-edit-mode"
          aria-label={editMode ? 'Editando' : 'Editar layout'}
        >
          <span className="md:hidden" aria-hidden="true">&#9998;</span>
          <span className="hidden md:inline">{editMode ? 'Editando' : 'Editar layout'}</span>
        </Button>

        {/* Heat map toggle — T29: icon on mobile */}
        <Button
          variant={heatMap ? 'default' : 'outline'}
          size="sm"
          onClick={toggleHeatMap}
          data-testid="toggle-heat-map"
          aria-label="Heat Map"
        >
          <span className="md:hidden" aria-hidden="true">&#9632;</span>
          <span className="hidden md:inline">Heat Map</span>
        </Button>

        {/* T29: Mobile filter toggle button */}
        <Button
          variant="outline"
          size="sm"
          className="md:hidden relative"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
          aria-label="Filtros"
        >
          &#9783;
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Edit mode actions */}
        {editMode && (
          <>
            <div className="h-5 w-px bg-border" />

            <Button
              variant="outline"
              size="sm"
              onClick={onResetLayout}
              aria-label="Restaurar auto-layout"
            >
              <span className="md:hidden" aria-hidden="true">&#8634;</span>
              <span className="hidden md:inline">Restaurar auto-layout</span>
            </Button>

            {hasPendingChanges && (
              <Button
                size="sm"
                onClick={onSaveLayout}
                disabled={isSaving}
                data-testid="save-layout-btn"
              >
                {isSaving ? '...' : ''}
                <span className="hidden md:inline">
                  {isSaving ? 'Guardando...' : 'Guardar layout'}
                </span>
                <span className="md:hidden">
                  {isSaving ? '...' : '&#10003;'}
                </span>
              </Button>
            )}

            {hasPendingChanges && (
              <Badge variant="secondary" className="hidden md:inline-flex text-xs">
                Cambios sin guardar
              </Badge>
            )}
          </>
        )}
      </div>

      {/* T29: Mobile search row (collapsible) */}
      {mobileSearchOpen && (
        <div className="md:hidden">
          <MapSearch
            warehouseId={warehouseId}
            onNavigateToZone={(zoneId) => {
              onNavigateToZone(zoneId)
              setMobileSearchOpen(false)
            }}
          />
        </div>
      )}

      {/* T23: Severity filter chips — T29: hidden on mobile behind toggle */}
      <div
        className={`flex-wrap items-center gap-1.5 ${
          mobileFiltersOpen ? 'flex' : 'hidden md:flex'
        }`}
      >
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
                className="size-2 rounded-full shrink-0"
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
