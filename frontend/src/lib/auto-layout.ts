interface LayoutInput {
  id: string
  value: number
}

interface LayoutRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Squarified treemap layout algorithm.
 * Places rectangles proportional to their value within the canvas,
 * applying padding between zones and enforcing minimum sizes.
 */
export function autoLayout(
  zones: LayoutInput[],
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 12,
): LayoutRect[] {
  if (zones.length === 0) return []

  const MIN_W = 80
  const MIN_H = 60

  // Ensure all values are at least 1
  const items = zones.map((z) => ({
    id: z.id,
    value: Math.max(z.value, 1),
  }))

  // Sort descending by value
  items.sort((a, b) => b.value - a.value)

  const totalValue = items.reduce((sum, z) => sum + z.value, 0)

  // Effective area (account for outer padding)
  const effectiveW = canvasWidth - padding * 2
  const effectiveH = canvasHeight - padding * 2

  if (effectiveW <= 0 || effectiveH <= 0) return []

  const results: LayoutRect[] = []

  squarify(
    items.map((item) => ({
      id: item.id,
      area: (item.value / totalValue) * effectiveW * effectiveH,
    })),
    [],
    { x: padding, y: padding, w: effectiveW, h: effectiveH },
    results,
    padding,
  )

  // Enforce minimum sizes
  return results.map((r) => ({
    ...r,
    width: Math.max(r.width, MIN_W),
    height: Math.max(r.height, MIN_H),
  }))
}

interface AreaItem {
  id: string
  area: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function squarify(
  items: AreaItem[],
  row: AreaItem[],
  rect: Rect,
  results: LayoutRect[],
  padding: number,
): void {
  if (items.length === 0) {
    layoutRow(row, rect, results, padding)
    return
  }

  if (row.length === 0) {
    squarify(items.slice(1), [items[0]], rect, results, padding)
    return
  }

  const newRow = [...row, items[0]]
  if (worstRatio(newRow, rect) <= worstRatio(row, rect)) {
    squarify(items.slice(1), newRow, rect, results, padding)
  } else {
    const remaining = layoutRow(row, rect, results, padding)
    squarify(items.slice(0), [], remaining, results, padding)
  }
}

function worstRatio(row: AreaItem[], rect: Rect): number {
  const totalArea = row.reduce((s, i) => s + i.area, 0)
  const side = Math.min(rect.w, rect.h)

  if (side === 0 || totalArea === 0) return Infinity

  let worst = 0
  for (const item of row) {
    const rowLen = totalArea / side
    const itemSide = item.area / rowLen
    const ratio = Math.max(rowLen / itemSide, itemSide / rowLen)
    if (ratio > worst) worst = ratio
  }
  return worst
}

function layoutRow(
  row: AreaItem[],
  rect: Rect,
  results: LayoutRect[],
  padding: number,
): Rect {
  if (row.length === 0) return rect

  const totalArea = row.reduce((s, i) => s + i.area, 0)
  const isHorizontal = rect.w >= rect.h
  const side = isHorizontal ? rect.h : rect.w
  const rowLen = side > 0 ? totalArea / side : 0

  let offset = 0

  for (const item of row) {
    const itemSize = rowLen > 0 ? item.area / rowLen : 0

    if (isHorizontal) {
      results.push({
        id: item.id,
        x: rect.x + padding / 2,
        y: rect.y + offset + padding / 2,
        width: rowLen - padding,
        height: itemSize - padding,
      })
    } else {
      results.push({
        id: item.id,
        x: rect.x + offset + padding / 2,
        y: rect.y + padding / 2,
        width: itemSize - padding,
        height: rowLen - padding,
      })
    }

    offset += itemSize
  }

  if (isHorizontal) {
    return {
      x: rect.x + rowLen,
      y: rect.y,
      w: rect.w - rowLen,
      h: rect.h,
    }
  }

  return {
    x: rect.x,
    y: rect.y + rowLen,
    w: rect.w,
    h: rect.h - rowLen,
  }
}
