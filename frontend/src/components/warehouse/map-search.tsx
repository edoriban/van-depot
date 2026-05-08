'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import type { MapSearchResult } from '@/types'

interface MapSearchProps {
  warehouseId: string
  onNavigateToZone: (zoneId: string) => void
}

export function MapSearch({ warehouseId, onNavigateToZone }: MapSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MapSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchResults = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([])
        setIsOpen(false)
        return
      }

      setIsLoading(true)
      try {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'
        const token = useAuthStore.getState().accessToken
        const headers: HeadersInit = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch(
          `${API_URL}/warehouses/${warehouseId}/map/search?q=${encodeURIComponent(q)}`,
          { headers },
        )

        if (!res.ok) {
          setResults([])
          return
        }

        const data: MapSearchResult[] = await res.json()
        setResults(data)
        setIsOpen(data.length > 0 || q.trim().length >= 2)
      } catch {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    },
    [warehouseId],
  )

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        fetchResults(value)
      }, 300)
    },
    [fetchResults],
  )

  const handleSelect = useCallback(
    (result: MapSearchResult) => {
      onNavigateToZone(result.zone_id)
      setIsOpen(false)
      setQuery('')
      setResults([])
    },
    [onNavigateToZone],
  )

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <Input
        type="search"
        placeholder="Buscar producto..."
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true)
        }}
        className="h-8 w-48 text-sm"
        data-testid="map-search-input"
      />

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-80 rounded-lg border bg-popover shadow-lg">
          {isLoading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Buscando...
            </div>
          )}

          {!isLoading && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Sin resultados
            </div>
          )}

          {!isLoading &&
            results.slice(0, 6).map((r) => (
              <button
                key={`${r.product_id}-${r.zone_id}`}
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors first:rounded-t-lg last:rounded-b-lg"
                onClick={() => handleSelect(r)}
                data-testid="map-search-result"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.product_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {r.quantity} uds
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{r.product_sku}</span>
                  <span>·</span>
                  <span className="truncate">
                    {r.zone_name} / {r.location_name}
                  </span>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
