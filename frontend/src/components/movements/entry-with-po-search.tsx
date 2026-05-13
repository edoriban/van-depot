/**
 * components/movements/entry-with-po-search.tsx — step-1 PO search input +
 * debounced result list for the entry-with-PO flow.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1.
 *
 * Owns the 300ms debounced GET `/purchase-orders?order_number=...` request
 * and renders matches as click-to-select buttons. The parent receives the
 * picked `PurchaseOrder` via `onSelect`.
 */
'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-mutations';
import type { PaginatedResponse, PurchaseOrder } from '@/types';

const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  partially_received: 'Parcial',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export interface EntryWithPoSearchProps {
  onSelect: (po: PurchaseOrder) => void;
}

interface SearchState {
  results: PurchaseOrder[];
  isLoading: boolean;
}

const INITIAL_SEARCH_STATE: SearchState = { results: [], isLoading: false };

export function EntryWithPoSearch({ onSelect }: EntryWithPoSearchProps) {
  const [poSearch, setPoSearch] = useState('');
  // Combined state object so the debounced effect performs ONE setState per
  // outcome (avoids no-cascading-set-state and matches §2 hyper-local rule).
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);

  useEffect(() => {
    if (poSearch.length < 2) {
      // Queue cleanup so the setState happens AFTER the effect commits,
      // satisfying react-hooks/set-state-in-effect.
      const reset = setTimeout(() => setSearchState(INITIAL_SEARCH_STATE), 0);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(async () => {
      setSearchState({ results: [], isLoading: true });
      try {
        const params = new URLSearchParams();
        params.set('order_number', poSearch);
        params.set('per_page', '10');
        const res = await api.get<PaginatedResponse<PurchaseOrder>>(
          `/purchase-orders?${params}`,
        );
        setSearchState({ results: res.data ?? [], isLoading: false });
      } catch {
        setSearchState({ results: [], isLoading: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [poSearch]);

  const { results: poResults, isLoading: isLoadingPOs } = searchState;

  return (
    <div className="space-y-3">
      <Label>Buscar orden de compra</Label>
      <Input
        value={poSearch}
        onChange={(e) => setPoSearch(e.target.value)}
        placeholder="Escribe el numero de orden…"
        data-testid="po-search"
      />
      {isLoadingPOs && <p className="text-sm text-muted-foreground">Buscando…</p>}
      {poResults.length > 0 && (
        <div className="rounded-lg border divide-y">
          {poResults.map((po) => (
            <button
              key={po.id}
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 text-left"
              onClick={() => {
                onSelect(po);
                setPoSearch('');
                setSearchState(INITIAL_SEARCH_STATE);
              }}
            >
              <div>
                <span className="font-mono font-medium">{po.order_number}</span>
                <span className="ml-2 text-sm text-muted-foreground">{po.supplier_name}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {PO_STATUS_LABELS[po.status] ?? po.status}
              </span>
            </button>
          ))}
        </div>
      )}
      {poSearch.length >= 2 && !isLoadingPOs && poResults.length === 0 && (
        <p className="text-sm text-muted-foreground">No se encontraron ordenes</p>
      )}
    </div>
  );
}
