'use client'

import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import useSWR from 'swr'
import KonvaLib from 'konva'
import type Konva from 'konva'
import { useMapStore } from '@/stores/map-store'
import { autoLayout } from '@/lib/auto-layout'
import { ZoneRect } from '@/components/warehouse/zone-rect'
import { RackRect, computeRackGrid } from '@/components/warehouse/rack-rect'
import { MapToolbar } from '@/components/warehouse/map-toolbar'
import { MiniMap } from '@/components/warehouse/mini-map'
import { MapTooltip } from '@/components/warehouse/map-tooltip'
import { HeatLegend } from '@/components/warehouse/heat-legend'
import type {
  ZoneHealth,
  ZoneHealthWithLayout,
  LocationPosition,
  Location,
  PaginatedResponse,
} from '@/types'
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
const STAGE_HEIGHT = 600
const SEMANTIC_ZOOM_THRESHOLD = 2

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
  const lastDistRef = useRef<number | null>(null) // T26: pinch-to-zoom

  const canvasW = propCanvasW || DEFAULT_CANVAS_W
  const canvasH = propCanvasH || DEFAULT_CANVAS_H

  const {
    zoom,
    position,
    selectedZoneId,
    editMode,
    heatMap,
    searchQuery,
    highlightedLocationId,
    hoveredZone,
    severityFilters,
    pendingPositions,
    setZoom,
    setPosition,
    selectZone,
    setHighlight,
    setPendingPosition,
    clearPendingPositions,
  } = useMapStore()

  // --- T17: Semantic zoom - fetch racks when zoom > 2x ---
  // Collect zone IDs that are visible (simplified: all zones when zoomed in)
  const shouldFetchRacks = zoom > SEMANTIC_ZOOM_THRESHOLD

  // Fetch all child locations for the warehouse when zoom is high enough
  // SWR conditional key: only fetch when zoom crosses threshold
  const { data: racksData } = useSWR<PaginatedResponse<Location>>(
    shouldFetchRacks
      ? `/warehouses/${warehouseId}/locations?per_page=500&page=1`
      : null,
  )

  // Group racks by parent zone ID
  const racksByZone = useMemo(() => {
    const map = new Map<string, Location[]>()
    if (!racksData?.data) return map
    for (const loc of racksData.data) {
      if (loc.parent_id && loc.location_type !== 'zone') {
        const existing = map.get(loc.parent_id) ?? []
        existing.push(loc)
        map.set(loc.parent_id, existing)
      }
    }
    return map
  }, [racksData])

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

  // --- T25: Animate smooth transitions for zoom/pan ---
  const animateToView = useCallback(
    (newZoom: number, newPos: { x: number; y: number }) => {
      const stage = stageRef.current
      if (!stage) {
        setZoom(newZoom)
        setPosition(newPos)
        return
      }
      stage.to({
        scaleX: newZoom,
        scaleY: newZoom,
        x: newPos.x,
        y: newPos.y,
        duration: 0.25,
        easing: KonvaLib.Easings.EaseInOut,
        onFinish: () => {
          setZoom(newZoom)
          setPosition(newPos)
        },
      })
    },
    [setZoom, setPosition],
  )

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

  // T25: Animated zoom in/out
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.max(0.1, Math.min(5, zoom * 1.2))
    animateToView(newZoom, position)
  }, [zoom, position, animateToView])

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.1, Math.min(5, zoom / 1.2))
    animateToView(newZoom, position)
  }, [zoom, position, animateToView])

  // T25: Animated fit-to-screen
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
    const scaleY = STAGE_HEIGHT / (contentH + 40)
    const newZoom = Math.min(scaleX, scaleY, 2)

    const newPos = {
      x: (containerWidth - contentW * newZoom) / 2 - minX * newZoom,
      y: (STAGE_HEIGHT - contentH * newZoom) / 2 - minY * newZoom,
    }
    animateToView(newZoom, newPos)
  }, [zonesWithLayout, containerWidth, animateToView])

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

  // --- T19: Mini-map navigation handler ---
  const handleMiniMapNavigate = useCallback(
    (x: number, y: number) => {
      setPosition({ x, y })
    },
    [setPosition],
  )

  // --- T22: Navigate to zone (from search) — T25: animated ---
  const handleNavigateToZone = useCallback(
    (zoneId: string) => {
      const zone = zonesWithLayout.find((z) => z.zone_id === zoneId)
      if (!zone) return

      // Center the zone in the viewport with zoom ~1.5x
      const targetZoom = Math.max(zoom, 1.5)
      const cx = zone.pos_x + zone.width / 2
      const cy = zone.pos_y + zone.height / 2

      const newPos = {
        x: containerWidth / 2 - cx * targetZoom,
        y: STAGE_HEIGHT / 2 - cy * targetZoom,
      }
      animateToView(targetZoom, newPos)
      selectZone(zoneId)
      onZoneSelect(zoneId)
      setHighlight(zoneId)
    },
    [zonesWithLayout, zoom, containerWidth, animateToView, selectZone, onZoneSelect, setHighlight],
  )

  // --- T24: Auto-clear highlight after 3 seconds ---
  useEffect(() => {
    if (!highlightedLocationId) return
    const timer = setTimeout(() => {
      setHighlight(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [highlightedLocationId, setHighlight])

  // --- T26: Pinch-to-zoom touch handlers ---
  const handleTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const touch1 = e.evt.touches[0]
      const touch2 = e.evt.touches[1]
      if (touch1 && touch2) {
        e.evt.preventDefault()
        const dist = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY,
        )
        if (lastDistRef.current) {
          const scale = dist / lastDistRef.current
          const newZoom = Math.max(0.1, Math.min(5, zoom * scale))
          setZoom(newZoom)
        }
        lastDistRef.current = dist
      }
    },
    [zoom, setZoom],
  )

  const handleTouchEnd = useCallback(() => {
    lastDistRef.current = null
  }, [])

  // --- T27: Keyboard navigation ---
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Make container focusable
    if (!container.hasAttribute('tabindex')) {
      container.tabIndex = 0
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const PAN_STEP = 50
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          setPosition({ x: position.x + PAN_STEP, y: position.y })
          break
        case 'ArrowRight':
          e.preventDefault()
          setPosition({ x: position.x - PAN_STEP, y: position.y })
          break
        case 'ArrowUp':
          e.preventDefault()
          setPosition({ x: position.x, y: position.y + PAN_STEP })
          break
        case 'ArrowDown':
          e.preventDefault()
          setPosition({ x: position.x, y: position.y - PAN_STEP })
          break
        case '+':
        case '=':
          e.preventDefault()
          handleZoomIn()
          break
        case '-':
          e.preventDefault()
          handleZoomOut()
          break
        case '0':
          e.preventDefault()
          handleFitToScreen()
          break
        case 'Escape':
          selectZone(null)
          onZoneSelect(null)
          break
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [position, setPosition, handleZoomIn, handleZoomOut, handleFitToScreen, selectZone, onZoneSelect])

  // --- T28: Viewport virtualization for large warehouses ---
  const visibleZones = useMemo(() => {
    // For small sets, skip culling overhead
    if (zonesWithLayout.length <= 50) return zonesWithLayout

    const viewLeft = -position.x / zoom
    const viewTop = -position.y / zoom
    const viewRight = viewLeft + containerWidth / zoom
    const viewBottom = viewTop + STAGE_HEIGHT / zoom

    // Render margin for smooth scrolling
    const margin = 100

    return zonesWithLayout.filter(
      (z) =>
        z.pos_x + z.width > viewLeft - margin &&
        z.pos_x < viewRight + margin &&
        z.pos_y + z.height > viewTop - margin &&
        z.pos_y < viewBottom + margin,
    )
  }, [zonesWithLayout, position, zoom, containerWidth])

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

  // --- T17: Compute rack positions for semantic zoom ---
  const rackElements = useMemo(() => {
    if (!shouldFetchRacks) return []

    const elements: Array<{
      rack: Location
      x: number
      y: number
      w: number
      h: number
    }> = []

    for (const zone of zonesWithLayout) {
      const zoneRacks = racksByZone.get(zone.zone_id)
      if (!zoneRacks || zoneRacks.length === 0) continue
      const grid = computeRackGrid(zoneRacks, zone)
      elements.push(...grid)
    }

    return elements
  }, [shouldFetchRacks, zonesWithLayout, racksByZone])

  const hasPendingChanges = pendingPositions.size > 0

  return (
    <div className="space-y-3">
      <MapToolbar
        warehouseId={warehouseId}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onResetLayout={handleResetLayout}
        onSaveLayout={handleSaveLayout}
        onNavigateToZone={handleNavigateToZone}
        hasPendingChanges={hasPendingChanges}
        isSaving={isSaving}
      />

      {/* T26: touch-action: none prevents browser scroll conflicts */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height: STAGE_HEIGHT, touchAction: 'none' }}
        data-testid="map-canvas-container"
      >
        <Stage
          ref={stageRef}
          width={containerWidth}
          height={STAGE_HEIGHT}
          scaleX={zoom}
          scaleY={zoom}
          x={position.x}
          y={position.y}
          draggable={!editMode}
          onWheel={handleWheel}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
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

          {/* Zones layer — T28: uses visibleZones for viewport culling */}
          <Layer>
            {visibleZones.map((zone) => {
              const isMatch = matchesSearch(zone)
              const searchDimmed = !!searchQuery && !isMatch
              const severityDimmed =
                severityFilters.size > 0 && !severityFilters.has(zone.severity)
              return (
                <ZoneRect
                  key={zone.zone_id}
                  zone={zone}
                  isSelected={selectedZoneId === zone.zone_id}
                  editMode={editMode}
                  dimmed={searchDimmed || severityDimmed}
                  highlighted={highlightedLocationId === zone.zone_id}
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

          {/* T17: Racks layer (only visible at zoom > 2x) */}
          {shouldFetchRacks && rackElements.length > 0 && (
            <Layer listening={false}>
              {rackElements.map((item) => (
                <RackRect
                  key={item.rack.id}
                  rack={item.rack}
                  gridX={item.x}
                  gridY={item.y}
                  rackWidth={item.w}
                  rackHeight={item.h}
                />
              ))}
            </Layer>
          )}

          {/* T18: Tooltip layer */}
          {hoveredZone && !editMode && (
            <Layer listening={false}>
              <MapTooltip
                zone={hoveredZone.zone}
                x={hoveredZone.x}
                y={hoveredZone.y}
                stageWidth={containerWidth}
                stageHeight={STAGE_HEIGHT}
              />
            </Layer>
          )}
        </Stage>

        {/* T19: Mini-map overlay */}
        <MiniMap
          zones={zonesWithLayout}
          canvasWidth={canvasW}
          canvasHeight={canvasH}
          viewportX={position.x}
          viewportY={position.y}
          viewportWidth={containerWidth / zoom}
          viewportHeight={STAGE_HEIGHT / zoom}
          zoom={zoom}
          onNavigate={handleMiniMapNavigate}
        />
      </div>

      {/* T20: Heat map legend */}
      {heatMap && <HeatLegend />}
    </div>
  )
}
