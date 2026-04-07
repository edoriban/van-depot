import { create } from 'zustand'

interface PendingPosition {
  x: number
  y: number
  w: number
  h: number
}

interface MapState {
  zoom: number
  position: { x: number; y: number }
  selectedZoneId: string | null
  editMode: boolean
  heatMap: boolean
  searchQuery: string
  highlightedLocationId: string | null
  pendingPositions: Map<string, PendingPosition>

  setZoom: (zoom: number) => void
  setPosition: (pos: { x: number; y: number }) => void
  selectZone: (id: string | null) => void
  toggleEditMode: () => void
  toggleHeatMap: () => void
  setSearchQuery: (q: string) => void
  setHighlight: (id: string | null) => void
  setPendingPosition: (id: string, pos: PendingPosition) => void
  clearPendingPositions: () => void
  resetView: () => void
}

export const useMapStore = create<MapState>((set) => ({
  zoom: 1,
  position: { x: 0, y: 0 },
  selectedZoneId: null,
  editMode: false,
  heatMap: false,
  searchQuery: '',
  highlightedLocationId: null,
  pendingPositions: new Map(),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
  setPosition: (position) => set({ position }),
  selectZone: (selectedZoneId) => set({ selectedZoneId }),
  toggleEditMode: () =>
    set((s) => ({ editMode: !s.editMode })),
  toggleHeatMap: () =>
    set((s) => ({ heatMap: !s.heatMap })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setHighlight: (highlightedLocationId) => set({ highlightedLocationId }),
  setPendingPosition: (id, pos) =>
    set((s) => {
      const next = new Map(s.pendingPositions)
      next.set(id, pos)
      return { pendingPositions: next }
    }),
  clearPendingPositions: () => set({ pendingPositions: new Map() }),
  resetView: () =>
    set({ zoom: 1, position: { x: 0, y: 0 }, selectedZoneId: null }),
}))
