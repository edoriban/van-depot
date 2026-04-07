'use client'

/**
 * Heat map color legend showing the gradient scale.
 * Rendered below the canvas when heat map mode is active.
 */
export function HeatLegend() {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/80 px-3 py-2 text-xs">
      <span className="font-medium text-muted-foreground">Intensidad:</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">OK</span>
        <div
          className="h-3 w-24 rounded-sm"
          style={{
            background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)',
          }}
        />
        <span className="text-muted-foreground">Critico</span>
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1">
        <div className="h-3 w-5 rounded-sm" style={{ background: '#d1d5db' }} />
        <span className="text-muted-foreground">Vacio</span>
      </div>
    </div>
  )
}
