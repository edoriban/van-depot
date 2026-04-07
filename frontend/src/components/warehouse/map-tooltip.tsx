'use client'

import { Group, Rect, Text } from 'react-konva'
import { SEVERITY_CONFIG } from '@/lib/severity'
import type { ZoneHealthWithLayout } from '@/types'

interface MapTooltipProps {
  zone: ZoneHealthWithLayout
  /** Pointer position in stage (screen) coordinates */
  x: number
  y: number
  /** Stage dimensions for clamping */
  stageWidth: number
  stageHeight: number
}

const TIP_W = 200
const TIP_H = 110
const TIP_OFFSET = 12
const PADDING = 10
const LINE_H = 16
const FONT_SIZE = 11
const TITLE_FONT = 12

/**
 * Konva-based tooltip rendered on a dedicated layer.
 * Positioned near the pointer, clamped to stage edges.
 */
export function MapTooltip({
  zone,
  x,
  y,
  stageWidth,
  stageHeight,
}: MapTooltipProps) {
  // Clamp so the tooltip doesn't overflow the canvas
  let tipX = x + TIP_OFFSET
  let tipY = y + TIP_OFFSET

  if (tipX + TIP_W > stageWidth) {
    tipX = x - TIP_W - TIP_OFFSET
  }
  if (tipY + TIP_H > stageHeight) {
    tipY = y - TIP_H - TIP_OFFSET
  }
  // Ensure minimum bounds
  tipX = Math.max(4, tipX)
  tipY = Math.max(4, tipY)

  const config = SEVERITY_CONFIG[zone.severity]
  const occupationPct =
    zone.total_items > 0
      ? `${zone.total_items} items`
      : 'Vacio'

  const alertCount = zone.critical_count + zone.low_count + zone.warning_count

  return (
    <Group x={tipX} y={tipY} listening={false}>
      {/* Background with shadow */}
      <Rect
        width={TIP_W}
        height={TIP_H}
        fill="#1e293b"
        cornerRadius={8}
        shadowColor="rgba(0,0,0,0.25)"
        shadowBlur={12}
        shadowOffset={{ x: 0, y: 4 }}
        opacity={0.95}
      />

      {/* Zone name (title) */}
      <Text
        text={zone.zone_name}
        x={PADDING}
        y={PADDING}
        width={TIP_W - PADDING * 2}
        fontSize={TITLE_FONT}
        fontStyle="bold"
        fill="#f8fafc"
        ellipsis
        wrap="none"
      />

      {/* Severity */}
      <Text
        text={`Estado: ${config.label}`}
        x={PADDING}
        y={PADDING + LINE_H + 2}
        width={TIP_W - PADDING * 2}
        fontSize={FONT_SIZE}
        fill="#cbd5e1"
      />

      {/* Items */}
      <Text
        text={`Inventario: ${occupationPct}`}
        x={PADDING}
        y={PADDING + LINE_H * 2 + 2}
        width={TIP_W - PADDING * 2}
        fontSize={FONT_SIZE}
        fill="#cbd5e1"
      />

      {/* Alerts */}
      <Text
        text={`Alertas: ${alertCount} (${zone.critical_count} crit, ${zone.low_count} bajo, ${zone.warning_count} alerta)`}
        x={PADDING}
        y={PADDING + LINE_H * 3 + 2}
        width={TIP_W - PADDING * 2}
        fontSize={FONT_SIZE}
        fill="#cbd5e1"
        ellipsis
        wrap="none"
      />

      {/* Locations */}
      <Text
        text={`Ubicaciones: ${zone.child_location_count}`}
        x={PADDING}
        y={PADDING + LINE_H * 4 + 2}
        width={TIP_W - PADDING * 2}
        fontSize={FONT_SIZE}
        fill="#cbd5e1"
      />
    </Group>
  )
}
