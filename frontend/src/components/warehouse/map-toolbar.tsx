'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useMapStore } from '@/stores/map-store'

interface MapToolbarProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitToScreen: () => void
  onResetLayout: () => void
  onSaveLayout: () => void
  hasPendingChanges: boolean
  isSaving: boolean
}

export function MapToolbar({
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetLayout,
  onSaveLayout,
  hasPendingChanges,
  isSaving,
}: MapToolbarProps) {
  const { zoom, editMode, heatMap, toggleEditMode, toggleHeatMap } =
    useMapStore()

  const zoomPct = `${Math.round(zoom * 100)}%`

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="map-toolbar">
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
  )
}
