import type { ZoneSeverity } from '@/types'

export const SEVERITY_CONFIG: Record<ZoneSeverity, {
  label: string
  bg: string
  text: string
  dot: string
}> = {
  critical: {
    label: 'Critico',
    bg: 'bg-red-500/10',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  low: {
    label: 'Bajo',
    bg: 'bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  warning: {
    label: 'Alerta',
    bg: 'bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-400',
  },
  ok: {
    label: 'OK',
    bg: 'bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
    dot: 'bg-green-500',
  },
  empty: {
    label: 'Vacio',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
}
