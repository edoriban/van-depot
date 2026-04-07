import type { ZoneSeverity } from '@/types'

/**
 * Hex color palette for canvas rendering (Konva).
 * Mirrors SEVERITY_CONFIG from severity.ts but uses raw hex for canvas fills.
 */
export const SEVERITY_HEX: Record<
  ZoneSeverity,
  { fill: string; fillHeat: string; stroke: string; text: string }
> = {
  critical: {
    fill: '#fecaca',     // red-200
    fillHeat: '#ef4444', // red-500
    stroke: '#dc2626',   // red-600
    text: '#991b1b',     // red-800
  },
  low: {
    fill: '#fed7aa',     // orange-200
    fillHeat: '#f97316', // orange-500
    stroke: '#ea580c',   // orange-600
    text: '#9a3412',     // orange-800
  },
  warning: {
    fill: '#fde68a',     // amber-200
    fillHeat: '#f59e0b', // amber-500
    stroke: '#d97706',   // amber-600
    text: '#92400e',     // amber-800
  },
  ok: {
    fill: '#bbf7d0',     // green-200
    fillHeat: '#22c55e', // green-500
    stroke: '#16a34a',   // green-600
    text: '#166534',     // green-800
  },
  empty: {
    fill: '#e5e7eb',     // gray-200
    fillHeat: '#9ca3af', // gray-400
    stroke: '#6b7280',   // gray-500
    text: '#374151',     // gray-700
  },
}
