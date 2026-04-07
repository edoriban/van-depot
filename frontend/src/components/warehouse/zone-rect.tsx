'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Group, Rect, Text } from 'react-konva'
import { SEVERITY_HEX } from '@/lib/severity-colors'
import { SEVERITY_CONFIG } from '@/lib/severity'
import { useMapStore } from '@/stores/map-store'
import type { ZoneHealthWithLayout } from '@/types'
import type Konva from 'konva'

interface ZoneRectProps {
  zone: ZoneHealthWithLayout
  isSelected: boolean
  editMode: boolean
  dimmed: boolean
  highlighted: boolean
  heatMap: boolean
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
}

/**
 * Compute a heat map fill color based on alert intensity.
 * Maps the ratio of alerts to total items onto a green -> yellow -> red gradient.
 * Empty zones get a muted gray.
 */
function computeHeatFill(zone: ZoneHealthWithLayout): string {
  if (zone.severity === 'empty') return '#d1d5db' // gray-300 muted

  const totalAlerts = zone.critical_count + zone.low_count + zone.warning_count
  if (zone.total_items === 0) return '#d1d5db'

  // Weight critical alerts more heavily
  const weightedAlerts = zone.critical_count * 3 + zone.low_count * 1.5 + zone.warning_count
  const ratio = Math.min(weightedAlerts / Math.max(zone.total_items, 1), 1)

  // Interpolate: green (0) -> yellow (0.5) -> red (1)
  if (ratio <= 0.5) {
    // green -> yellow
    const t = ratio * 2
    const r = Math.round(34 + (234 - 34) * t)   // #22 -> #ea
    const g = Math.round(197 + (179 - 197) * t)  // #c5 -> #b3
    const b = Math.round(94 + (8 - 94) * t)      // #5e -> #08
    return `rgb(${r},${g},${b})`
  }
  // yellow -> red
  const t = (ratio - 0.5) * 2
  const r = Math.round(234 + (239 - 234) * t)  // #ea -> #ef
  const g = Math.round(179 - 179 * t)           // #b3 -> #00
  const b = Math.round(8 - 8 * t)               // #08 -> #00
  return `rgb(${r},${g},${b})`
}

export function ZoneRect({
  zone,
  isSelected,
  editMode,
  dimmed,
  highlighted,
  heatMap,
  onSelect,
  onDragEnd,
}: ZoneRectProps) {
  const setHoveredZone = useMapStore((s) => s.setHoveredZone)
  const colors = SEVERITY_HEX[zone.severity]
  const config = SEVERITY_CONFIG[zone.severity]
  const fill = heatMap ? computeHeatFill(zone) : colors.fill
  const opacity = dimmed ? 0.2 : 1

  // T24: Highlight pulse animation
  const [pulseOn, setPulseOn] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null)

  useEffect(() => {
    if (!highlighted) {
      setPulseOn(false)
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    // Blink every 300ms for 3 seconds
    setPulseOn(true)
    intervalRef.current = setInterval(() => {
      setPulseOn((prev) => !prev)
    }, 300)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [highlighted])

  const strokeColor = highlighted
    ? pulseOn
      ? '#facc15' // yellow-400 pulse
      : '#2563eb' // blue-600
    : isSelected
      ? '#2563eb'
      : colors.stroke
  const strokeWidth = highlighted ? (pulseOn ? 5 : 3) : isSelected ? 3 : 1.5

  // Calculate font sizes based on rect dimensions
  const nameFontSize = Math.min(14, Math.max(10, zone.width / 10))
  const statFontSize = Math.min(11, Math.max(8, zone.width / 14))

  // In heat map mode, use white text for better contrast on colored backgrounds
  const textFill = heatMap ? '#ffffff' : colors.text
  const subTextFill = heatMap ? 'rgba(255,255,255,0.85)' : colors.text

  const handleMouseEnter = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const container = e.target.getStage()?.container()
      if (container) {
        container.style.cursor = editMode ? 'move' : 'pointer'
      }
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (pointer) {
        setHoveredZone({ zone, x: pointer.x, y: pointer.y })
      }
    },
    [editMode, zone, setHoveredZone],
  )

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (pointer) {
        setHoveredZone({ zone, x: pointer.x, y: pointer.y })
      }
    },
    [zone, setHoveredZone],
  )

  const handleMouseLeave = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const container = e.target.getStage()?.container()
      if (container) {
        container.style.cursor = 'default'
      }
      setHoveredZone(null)
    },
    [setHoveredZone],
  )

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
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
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
        fill={textFill}
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
        fill={subTextFill}
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
