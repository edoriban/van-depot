'use client'

import { Group, Rect, Text } from 'react-konva'
import { SEVERITY_HEX } from '@/lib/severity-colors'
import { SEVERITY_CONFIG } from '@/lib/severity'
import type { ZoneHealthWithLayout } from '@/types'

interface ZoneRectProps {
  zone: ZoneHealthWithLayout
  isSelected: boolean
  editMode: boolean
  dimmed: boolean
  heatMap: boolean
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
}

export function ZoneRect({
  zone,
  isSelected,
  editMode,
  dimmed,
  heatMap,
  onSelect,
  onDragEnd,
}: ZoneRectProps) {
  const colors = SEVERITY_HEX[zone.severity]
  const config = SEVERITY_CONFIG[zone.severity]
  const fill = heatMap ? colors.fillHeat : colors.fill
  const opacity = dimmed ? 0.2 : 1

  const strokeColor = isSelected ? '#2563eb' : colors.stroke
  const strokeWidth = isSelected ? 3 : 1.5

  // Calculate font sizes based on rect dimensions
  const nameFontSize = Math.min(14, Math.max(10, zone.width / 10))
  const statFontSize = Math.min(11, Math.max(8, zone.width / 14))

  return (
    <Group
      x={zone.pos_x}
      y={zone.pos_y}
      draggable={editMode}
      opacity={opacity}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onDragEnd(e.target.x(), e.target.y())
      }}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container()
        if (container) {
          container.style.cursor = editMode ? 'move' : 'pointer'
        }
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container()
        if (container) {
          container.style.cursor = 'default'
        }
      }}
    >
      {/* Zone rectangle */}
      <Rect
        width={zone.width}
        height={zone.height}
        fill={fill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        cornerRadius={8}
        shadowColor={isSelected ? '#2563eb' : 'rgba(0,0,0,0.1)'}
        shadowBlur={isSelected ? 8 : 4}
        shadowOffset={{ x: 0, y: 2 }}
        shadowOpacity={isSelected ? 0.3 : 0.15}
      />

      {/* Zone name */}
      <Text
        text={zone.zone_name}
        x={8}
        y={zone.height / 2 - nameFontSize - 2}
        width={zone.width - 16}
        fontSize={nameFontSize}
        fontStyle="bold"
        fill={heatMap ? '#ffffff' : colors.text}
        align="center"
        ellipsis
        wrap="none"
      />

      {/* Item count */}
      <Text
        text={`${zone.total_items} item${zone.total_items !== 1 ? 's' : ''}`}
        x={8}
        y={zone.height / 2 + 4}
        width={zone.width - 16}
        fontSize={statFontSize}
        fill={heatMap ? 'rgba(255,255,255,0.85)' : colors.text}
        align="center"
        ellipsis
        wrap="none"
      />

      {/* Severity badge */}
      <Text
        text={config.label}
        x={8}
        y={zone.height - statFontSize - 10}
        width={zone.width - 16}
        fontSize={statFontSize}
        fill={heatMap ? 'rgba(255,255,255,0.7)' : colors.text}
        align="center"
        ellipsis
        wrap="none"
      />
    </Group>
  )
}
