'use client'

import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import type Konva from 'konva'
import { useMapStore } from '@/stores/map-store'
import { autoLayout } from '@/lib/auto-layout'
import { ZoneRect } from '@/components/warehouse/zone-rect'
import { MapToolbar } from '@/components/warehouse/map-toolbar'
import type { ZoneHealth, ZoneHealthWithLayout, LocationPosition } from '@/types'
import { toast } from 'sonner'
import { api } from '@/lib/api-mutations'

interface MapCanvasProps {
  zones: ZoneHealth[]
  canvasWidth: number
  canvasHeight: number
  warehouseId: string
  onZoneSelect: (zoneId: string | null) => void
}

const GRID_SPACING = 100
const DEFAULT_CANVAS_W = 1200
const DEFAULT_CANVAS_H = 700

export default function MapCanvas({
  zones,
  canvasWidth: propCanvasW,
  canvasHeight: propCanvasH,
  warehouseId,
  onZoneSelect,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(DEFAULT_CANVAS_W)
  const [isSaving, setIsSaving] = useState(false)

  const canvasW = propCanvasW || DEFAULT_CANVAS_W
  const canvasH = propCanvasH || DEFAULT_CANVAS_H

  const {
    zoom,
    position,
    selectedZoneId,
    editMode,
    heatMap,
    searchQuery,
    pendingPositions,
    setZoom,
    setPosition,
    selectZone,
    setPendingPosition,
    clearPendingPositions,
  } = useMapStore()

  // Observe container width for responsive Stage
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    ro.observe(container)
    setContainerWidth(container.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Compute zones with layout positions
  const zonesWithLayout: ZoneHealthWithLayout[] = useMemo(() => {
    // Check if zones already have positions from backend
    const allHavePositions = zones.every(
      (z) => z.pos_x != null && z.pos_y != null && z.width != null && z.height != null,
    )

    if (allHavePositions) {
      return zones.map((z) => {
        const pending = pendingPositions.get(z.zone_id)
        return {
          ...z,
          pos_x: pending?.x ?? z.pos_x!,
          pos_y: pending?.y ?? z.pos_y!,
          width: pending?.w ?? z.width!,
          height: pending?.h ?? z.height!,
        }
      })
    }

    // Auto-layout for zones without positions
    const layoutInputs = zones.map((z) => ({
      id: z.zone_id,
      value: z.total_items,
    }))

    const rects = autoLayout(layoutInputs, canvasW, canvasH)

    return zones.map((z) => {
      const pending = pendingPositions.get(z.zone_id)
      const rect = rects.find((r) => r.id === z.zone_id)
      return {
        ...z,
        pos_x: pending?.x ?? rect?.x ?? 0,
        pos_y: pending?.y ?? rect?.y ?? 0,
        width: pending?.w ?? rect?.width ?? 120,
        height: pending?.h ?? rect?.height ?? 80,
      }
    })
  }, [zones, canvasW, canvasH, pendingPositions])

  // Filtered by search
  const searchLower = searchQuery.toLowerCase()
  const matchesSearch = useCallback(
    (zone: ZoneHealthWithLayout) =>
      !searchQuery || zone.zone_name.toLowerCase().includes(searchLower),
    [searchQuery, searchLower],
  )

  // --- Actions ---

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return

      const oldScale = zoom
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const direction = e.evt.deltaY > 0 ? -1 : 1
      const factor = 1.08
      const newScale = direction > 0 ? oldScale * factor : oldScale / factor

      const mousePointTo = {
        x: (pointer.x - position.x) / oldScale,
        y: (pointer.y - position.y) / oldScale,
      }

      setZoom(newScale)
      setPosition({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      })
    },
    [zoom, position, setZoom, setPosition],
  )

  const handleZoomIn = useCallback(() => {
    setZoom(zoom * 1.2)
  }, [zoom, setZoom])

  const handleZoomOut = useCallback(() => {
    setZoom(zoom / 1.2)
  }, [zoom, setZoom])

  const handleFitToScreen = useCallback(() => {
    if (zonesWithLayout.length === 0) return

    const minX = Math.min(...zonesWithLayout.map((z) => z.pos_x))
    const minY = Math.min(...zonesWithLayout.map((z) => z.pos_y))
    const maxX = Math.max(...zonesWithLayout.map((z) => z.pos_x + z.width))
    const maxY = Math.max(...zonesWithLayout.map((z) => z.pos_y + z.height))

    const contentW = maxX - minX
    const contentH = maxY - minY

    if (contentW === 0 || contentH === 0) return

    const scaleX = containerWidth / (contentW + 40)
    const scaleY = 600 / (contentH + 40)
    const newZoom = Math.min(scaleX, scaleY, 2)

    setZoom(newZoom)
    setPosition({
      x: (containerWidth - contentW * newZoom) / 2 - minX * newZoom,
      y: (600 - contentH * newZoom) / 2 - minY * newZoom,
    })
  }, [zonesWithLayout, containerWidth, setZoom, setPosition])

  const handleResetLayout = useCallback(() => {
    clearPendingPositions()
  }, [clearPendingPositions])

  const handleSaveLayout = useCallback(async () => {
    setIsSaving(true)
    try {
      const positions: LocationPosition[] = zonesWithLayout.map((z) => ({
        id: z.zone_id,
        pos_x: z.pos_x,
        pos_y: z.pos_y,
        width: z.width,
        height: z.height,
      }))

      await api.put(`/warehouses/${warehouseId}/layout`, {
        locations: positions,
        canvas_width: canvasW,
        canvas_height: canvasH,
      })

      clearPendingPositions()
      toast.success('Layout guardado')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al guardar el layout',
      )
    } finally {
      setIsSaving(false)
    }
  }, [zonesWithLayout, warehouseId, canvasW, canvasH, clearPendingPositions])

  const handleDragEnd = useCallback(
    (zoneId: string, x: number, y: number) => {
      const zone = zonesWithLayout.find((z) => z.zone_id === zoneId)
      if (!zone) return
      setPendingPosition(zoneId, {
        x,
        y,
        w: zone.width,
        h: zone.height,
      })
    },
    [zonesWithLayout, setPendingPosition],
  )

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent> | Konva.KonvaEventObject<TouchEvent>) => {
      // Only deselect if clicking on the stage background
      if (e.target === e.target.getStage()) {
        selectZone(null)
        onZoneSelect(null)
      }
    },
    [selectZone, onZoneSelect],
  )

  // Grid lines
  const gridLines = useMemo(() => {
    const lines: { points: number[]; key: string }[] = []
    for (let x = 0; x <= canvasW; x += GRID_SPACING) {
      lines.push({ points: [x, 0, x, canvasH], key: `v-${x}` })
    }
    for (let y = 0; y <= canvasH; y += GRID_SPACING) {
      lines.push({ points: [0, y, canvasW, y], key: `h-${y}` })
    }
    return lines
  }, [canvasW, canvasH])

  const hasPendingChanges = pendingPositions.size > 0

  return (
    <div className="space-y-3">
      <MapToolbar
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onResetLayout={handleResetLayout}
        onSaveLayout={handleSaveLayout}
        hasPendingChanges={hasPendingChanges}
        isSaving={isSaving}
      />

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border bg-muted/30"
        style={{ height: 600 }}
        data-testid="map-canvas-container"
      >
        <Stage
          ref={stageRef}
          width={containerWidth}
          height={600}
          scaleX={zoom}
          scaleY={zoom}
          x={position.x}
          y={position.y}
          draggable={!editMode}
          onWheel={handleWheel}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) {
              setPosition({ x: e.target.x(), y: e.target.y() })
            }
          }}
        >
          {/* Grid layer */}
          <Layer listening={false}>
            {gridLines.map((line) => (
              <Line
                key={line.key}
                points={line.points}
                stroke="rgba(0,0,0,0.06)"
                strokeWidth={1}
              />
            ))}
          </Layer>

          {/* Zones layer */}
          <Layer>
            {zonesWithLayout.map((zone) => {
              const isMatch = matchesSearch(zone)
              return (
                <ZoneRect
                  key={zone.zone_id}
                  zone={zone}
                  isSelected={selectedZoneId === zone.zone_id}
                  editMode={editMode}
                  dimmed={!!searchQuery && !isMatch}
                  heatMap={heatMap}
                  onSelect={() => {
                    selectZone(zone.zone_id)
                    onZoneSelect(zone.zone_id)
                  }}
                  onDragEnd={(x, y) => handleDragEnd(zone.zone_id, x, y)}
                />
              )
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}
