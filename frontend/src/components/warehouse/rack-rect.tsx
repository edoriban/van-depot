'use client'

import { Group, Rect, Text } from 'react-konva'
import type { Location, ZoneHealthWithLayout } from '@/types'

const LOCATION_TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  rack: { fill: '#dbeafe', stroke: '#3b82f6' },    // blue-100 / blue-500
  shelf: { fill: '#e0e7ff', stroke: '#6366f1' },   // indigo-100 / indigo-500
  position: { fill: '#fae8ff', stroke: '#c026d3' }, // fuchsia-100 / fuchsia-600
  bin: { fill: '#f3e8ff', stroke: '#9333ea' },      // purple-100 / purple-600
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  rack: 'Rack',
  shelf: 'Estante',
  position: 'Pos.',
  bin: 'Bin',
}

const DEFAULT_COLORS = { fill: '#f1f5f9', stroke: '#94a3b8' }

interface RackRectProps {
  rack: Location
  /** Position within the parent zone grid */
  gridX: number
  gridY: number
  rackWidth: number
  rackHeight: number
}

export function RackRect({
  rack,
  gridX,
  gridY,
  rackWidth,
  rackHeight,
}: RackRectProps) {
  const colors = LOCATION_TYPE_COLORS[rack.location_type] ?? DEFAULT_COLORS
  const label = LOCATION_TYPE_LABELS[rack.location_type] ?? rack.location_type
  const fontSize = Math.min(10, Math.max(7, rackWidth / 8))

  return (
    <Group x={gridX} y={gridY}>
      <Rect
        width={rackWidth}
        height={rackHeight}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1}
        cornerRadius={4}
      />
      {/* Rack name */}
      <Text
        text={rack.name}
        x={3}
        y={rackHeight / 2 - fontSize}
        width={rackWidth - 6}
        fontSize={fontSize}
        fontStyle="bold"
        fill="#1e293b"
        align="center"
        ellipsis
        wrap="none"
      />
      {/* Type label */}
      <Text
        text={label}
        x={3}
        y={rackHeight / 2 + 2}
        width={rackWidth - 6}
        fontSize={Math.max(6, fontSize - 2)}
        fill="#64748b"
        align="center"
        ellipsis
        wrap="none"
      />
    </Group>
  )
}

/**
 * Compute grid positions for racks within a parent zone.
 * Auto-layouts racks as a simple grid inside the zone bounds.
 */
export function computeRackGrid(
  racks: Location[],
  parentZone: ZoneHealthWithLayout,
): Array<{ rack: Location; x: number; y: number; w: number; h: number }> {
  if (racks.length === 0) return []

  const padding = 8
  const innerW = parentZone.width - padding * 2
  const innerH = parentZone.height - padding * 2

  // Determine grid dimensions
  const cols = Math.max(1, Math.ceil(Math.sqrt(racks.length)))
  const rows = Math.max(1, Math.ceil(racks.length / cols))

  const gap = 4
  const cellW = (innerW - gap * (cols - 1)) / cols
  const cellH = (innerH - gap * (rows - 1)) / rows

  return racks.map((rack, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      rack,
      x: parentZone.pos_x + padding + col * (cellW + gap),
      y: parentZone.pos_y + padding + row * (cellH + gap),
      w: cellW,
      h: cellH,
    }
  })
}
