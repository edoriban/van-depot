'use client'

import { useCallback, useMemo } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import { SEVERITY_HEX } from '@/lib/severity-colors'
import type { ZoneHealthWithLayout } from '@/types'
import type Konva from 'konva'

interface MiniMapProps {
  zones: ZoneHealthWithLayout[]
  canvasWidth: number
  canvasHeight: number
  viewportX: number
  viewportY: number
  viewportWidth: number
  viewportHeight: number
  zoom: number
  onNavigate: (x: number, y: number) => void
}

const MINI_W = 180
const MINI_H = 120

export function MiniMap({
  zones,
  canvasWidth,
  canvasHeight,
  viewportX,
  viewportY,
  viewportWidth,
  viewportHeight,
  zoom,
  onNavigate,
}: MiniMapProps) {
  // Scale factor to fit the full canvas into the minimap
  const scale = useMemo(() => {
    const sx = MINI_W / canvasWidth
    const sy = MINI_H / canvasHeight
    return Math.min(sx, sy)
  }, [canvasWidth, canvasHeight])

  // Viewport rectangle in mini-map coordinates
  // viewportX/viewportY are the stage position (negative when panned right/down)
  const vpRect = useMemo(() => {
    return {
      x: (-viewportX / zoom) * scale,
      y: (-viewportY / zoom) * scale,
      width: viewportWidth * scale,
      height: viewportHeight * scale,
    }
  }, [viewportX, viewportY, viewportWidth, viewportHeight, zoom, scale])

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getPointerPosition()
      if (!pos) return

      // Convert mini-map coords back to canvas coords, then to stage position
      const canvasX = pos.x / scale
      const canvasY = pos.y / scale

      // Center the viewport on the clicked point
      const halfViewW = viewportWidth / 2
      const halfViewH = viewportHeight / 2

      onNavigate(
        -(canvasX - halfViewW) * zoom,
        -(canvasY - halfViewH) * zoom,
      )
    },
    [scale, viewportWidth, viewportHeight, zoom, onNavigate],
  )

  return (
    <div className="absolute bottom-3 right-3 hidden md:block rounded-lg border bg-background/80 backdrop-blur-sm shadow-lg overflow-hidden z-10">
      <Stage
        width={MINI_W}
        height={MINI_H}
        onClick={handleClick}
        style={{ cursor: 'crosshair' }}
      >
        {/* Background */}
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={MINI_W}
            height={MINI_H}
            fill="#f8fafc"
          />
        </Layer>

        {/* Zones (simplified - no text) */}
        <Layer listening={false}>
          {zones.map((zone) => (
            <Rect
              key={zone.zone_id}
              x={zone.pos_x * scale}
              y={zone.pos_y * scale}
              width={zone.width * scale}
              height={zone.height * scale}
              fill={SEVERITY_HEX[zone.severity].fill}
              stroke={SEVERITY_HEX[zone.severity].stroke}
              strokeWidth={0.5}
              cornerRadius={2}
            />
          ))}
        </Layer>

        {/* Viewport indicator */}
        <Layer listening={false}>
          <Rect
            x={vpRect.x}
            y={vpRect.y}
            width={vpRect.width}
            height={vpRect.height}
            fill="rgba(37, 99, 235, 0.12)"
            stroke="#2563eb"
            strokeWidth={1.5}
            cornerRadius={1}
            dash={[4, 2]}
          />
        </Layer>
      </Stage>
    </div>
  )
}
