'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-mutations';
import type {
  Product,
  Warehouse,
  Location,
  InventoryItem,
  PaginatedResponse,
  MovementType,
  StockAlert,
} from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
  BarCode01Icon,
} from '@hugeicons/core-free-icons';
import { SwipeableItem } from '@/components/shared/swipeable-item';
import { useIsMobile } from '@/hooks/use-mobile';

const BarcodeScanner = dynamic(
  () =>
    import('@/components/shared/barcode-scanner').then((m) => ({
      default: m.BarcodeScanner,
    })),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchIntentType =
  | 'stock_check'
  | 'location_check'
  | 'low_stock'
  | 'recent_movements'
  | 'product_search';

interface SearchIntent {
  type: SearchIntentType;
  productSearch?: string;
}

interface ProductWithStock extends Product {
  inventory: InventoryItem[];
}

interface RecentMovement {
  id: string;
  movement_type: MovementType;
  quantity: number;
  product_name: string;
  product_sku: string;
  from_location_name: string | null;
  to_location_name: string | null;
  user_name: string;
  created_at: string;
}

type FloorAction = 'entry' | 'exit' | 'transfer';

// ---------------------------------------------------------------------------
// Smart Search parser
// ---------------------------------------------------------------------------

function parseQuery(query: string): SearchIntent {
  const q = query.toLowerCase().trim();

  if (q.match(/cu[aá]nto|cuantos|quedan?|hay/)) {
    const productName = q
      .replace(/cu[aá]nto|cuantos|quedan?|hay|me|de|del/g, '')
      .trim();
    return { type: 'stock_check', productSearch: productName };
  }

  if (q.match(/d[oó]nde|donde|est[aá]|ubicaci[oó]n/)) {
    const productName = q
      .replace(/d[oó]nde|donde|est[aá]|ubicaci[oó]n|el|la|los|las/g, '')
      .trim();
    return { type: 'location_check', productSearch: productName };
  }

  if (q.match(/falta|comprar|pedir|reponer|bajo/)) {
    return { type: 'low_stock' };
  }

  if (q.match(/qui[eé]n|quien|sac[oó]|movi[oó]|ayer|hoy/)) {
    return { type: 'recent_movements' };
  }

  return { type: 'product_search', productSearch: q };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'justo ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHrs < 24) return `hace ${diffHrs}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString('es-MX');
}

const MOVEMENT_ICONS: Record<MovementType, Parameters<typeof HugeiconsIcon>[0]['icon']> = {
  entry: ArrowDown01Icon,
  exit: ArrowUp01Icon,
  transfer: ArrowDataTransferHorizontalIcon,
  adjustment: ArrowDataTransferHorizontalIcon,
};

const MOVEMENT_COLORS: Record<MovementType, string> = {
  entry: 'text-emerald-400',
  exit: 'text-red-400',
  transfer: 'text-blue-400',
  adjustment: 'text-amber-400',
};

// ---------------------------------------------------------------------------
// Haptic feedback
// ---------------------------------------------------------------------------

function hapticFeedback(type: 'success' | 'error' = 'success') {
  if ('vibrate' in navigator) {
    navigator.vibrate(type === 'success' ? 50 : [50, 30, 50]);
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function FloorModePage() {
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();

  // Scanner state
  const [scannerOpen, setScannerOpen] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const [searchResults, setSearchResults] = useState<ProductWithStock[]>([]);
  const [lowStockResults, setLowStockResults] = useState<StockAlert[]>([]);
  const [recentResults, setRecentResults] = useState<RecentMovement[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithStock | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Action form state
  const [activeAction, setActiveAction] = useState<FloorAction | null>(null);

  // Recent user actions
  const [recentActions, setRecentActions] = useState<RecentMovement[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Fetch recent actions on mount
  const fetchRecentActions = useCallback(async () => {
    try {
      setLoadingRecent(true);
      const res = await api.get<RecentMovement[]>('/dashboard/recent-movements');
      // Filter by current user and take first 5
      const userMovements = (res || [])
        .filter((m) => m.user_name === user?.name || m.user_name === user?.email)
        .slice(0, 5);
      setRecentActions(userMovements.length > 0 ? userMovements : (res || []).slice(0, 5));
    } catch {
      // silent
    } finally {
      setLoadingRecent(false);
    }
  }, [user?.name, user?.email]);

  useEffect(() => {
    fetchRecentActions();
  }, [fetchRecentActions]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setIntent(null);
      setSearchResults([]);
      setLowStockResults([]);
      setRecentResults([]);
      setSelectedProduct(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const parsed = parseQuery(query);
      setIntent(parsed);
      setIsSearching(true);

      try {
        if (parsed.type === 'low_stock') {
          const res = await api.get<{ data: StockAlert[] }>('/alerts?per_page=10');
          setLowStockResults(res.data ?? (res as unknown as StockAlert[]));
          setSearchResults([]);
          setRecentResults([]);
        } else if (parsed.type === 'recent_movements') {
          const res = await api.get<RecentMovement[]>('/dashboard/recent-movements');
          setRecentResults(res || []);
          setSearchResults([]);
          setLowStockResults([]);
        } else if (parsed.productSearch) {
          const productsRes = await api.get<Product[] | PaginatedResponse<Product>>(
            `/products?search=${encodeURIComponent(parsed.productSearch)}`
          );
          const products = Array.isArray(productsRes) ? productsRes : productsRes.data;

          // Fetch inventory for each product (limit to 8)
          const withStock: ProductWithStock[] = await Promise.all(
            products.slice(0, 8).map(async (p) => {
              try {
                const inv = await api.get<InventoryItem[]>(`/inventory/product/${p.id}`);
                return { ...p, inventory: inv || [] };
              } catch {
                return { ...p, inventory: [] };
              }
            })
          );

          setSearchResults(withStock);
          setLowStockResults([]);
          setRecentResults([]);
        }
      } catch {
        // silent
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelectProduct = (product: ProductWithStock) => {
    setSelectedProduct(product);
  };

  const handleActionFromCard = (action: FloorAction, product: ProductWithStock) => {
    setSelectedProduct(product);
    setActiveAction(action);
  };

  const handleScan = useCallback((code: string) => {
    setScannerOpen(false);
    hapticFeedback('success');
    setQuery(code);
  }, []);

  return (
    <div className="max-w-lg mx-auto pb-8" data-testid="floor-mode-page">
      {/* Scanner overlay */}
      {scannerOpen && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Hero search */}
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            className="flex-1 h-14 text-lg rounded-2xl bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30"
            placeholder="Buscar material..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="floor-search-input"
          />
          <button
            onClick={() => setScannerOpen(true)}
            className="size-14 shrink-0 rounded-2xl bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
            data-testid="floor-scan-btn"
          >
            <HugeiconsIcon icon={BarCode01Icon} className="size-6" />
          </button>
        </div>
        {intent && query.trim() && (
          <p className="text-xs text-muted-foreground mt-1 px-1" data-testid="search-intent-label">
            {intent.type === 'stock_check' && 'Buscando stock de...'}
            {intent.type === 'location_check' && 'Buscando ubicacion de...'}
            {intent.type === 'low_stock' && 'Mostrando productos con stock bajo'}
            {intent.type === 'recent_movements' && 'Mostrando movimientos recientes'}
            {intent.type === 'product_search' && 'Buscando productos...'}
          </p>
        )}
      </div>

      {/* Action form overlay */}
      {activeAction && (
        <ActionForm
          action={activeAction}
          preselectedProduct={selectedProduct}
          onClose={() => setActiveAction(null)}
          onSuccess={() => {
            setActiveAction(null);
            fetchRecentActions();
          }}
        />
      )}

      {/* Search results */}
      {isSearching && (
        <div className="px-4 space-y-3" data-testid="search-loading">
          <Skeleton className="h-20 w-full bg-muted rounded-xl" />
          <Skeleton className="h-20 w-full bg-muted rounded-xl" />
        </div>
      )}

      {!isSearching && !activeAction && (
        <>
          {/* Product results */}
          {searchResults.length > 0 && (
            <div className="px-4 space-y-3" data-testid="search-results">
              {isMobile && (
                <p className="text-xs text-muted-foreground px-1">
                  Desliza para registrar entrada o salida
                </p>
              )}
              {searchResults.map((product) => (
                <SwipeableItem
                  key={product.id}
                  disabled={!isMobile}
                  onSwipeRight={() => {
                    toast.info(`Registrar entrada de ${product.name}`);
                    handleActionFromCard('entry', product);
                  }}
                  onSwipeLeft={() => {
                    toast.info(`Registrar salida de ${product.name}`);
                    handleActionFromCard('exit', product);
                  }}
                  leftLabel="Entrada"
                  rightLabel="Salida"
                >
                  <ProductCard
                    product={product}
                    highlightLocations={intent?.type === 'location_check'}
                    onTap={handleSelectProduct}
                    onAction={handleActionFromCard}
                    isExpanded={selectedProduct?.id === product.id}
                  />
                </SwipeableItem>
              ))}
            </div>
          )}

          {/* Low stock results */}
          {lowStockResults.length > 0 && (
            <div className="px-4 space-y-2" data-testid="low-stock-results">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Productos con stock bajo</h3>
              {lowStockResults.map((alert) => (
                <Card
                  key={`${alert.product_id}-${alert.location_id}`}
                  className="bg-card border-border"
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground text-sm">{alert.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {alert.product_sku} &middot; {alert.location_name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-400">
                          {alert.current_quantity} / {alert.min_stock}
                        </p>
                        <p className="text-xs text-muted-foreground">{alert.warehouse_name}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Recent movements results */}
          {recentResults.length > 0 && (
            <div className="px-4 space-y-2" data-testid="recent-movements-results">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Movimientos recientes</h3>
              {recentResults.slice(0, 10).map((mov) => (
                <div
                  key={mov.id}
                  className="flex items-center justify-between bg-card rounded-xl p-3 border border-border"
                >
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={MOVEMENT_ICONS[mov.movement_type]} className={`size-5 ${MOVEMENT_COLORS[mov.movement_type]}`} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{mov.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {mov.from_location_name ?? '—'} → {mov.to_location_name ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{mov.quantity}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(mov.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty search state */}
          {query.trim() &&
            !isSearching &&
            searchResults.length === 0 &&
            lowStockResults.length === 0 &&
            recentResults.length === 0 && (
              <div className="px-4 text-center py-8" data-testid="search-empty">
                <p className="text-muted-foreground text-sm">No se encontraron resultados</p>
              </div>
            )}
        </>
      )}

      {/* Action buttons - only show when no active action */}
      {!activeAction && !query.trim() && (
        <>
          <div className="grid grid-cols-3 gap-3 p-4" data-testid="floor-action-buttons">
            <button
              onClick={() => setActiveAction('entry')}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-emerald-900/40 border border-emerald-800/50 p-5 min-h-[80px] active:scale-95 transition-transform"
              data-testid="floor-action-entry"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="size-7 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">Entrada</span>
            </button>
            <button
              onClick={() => setActiveAction('exit')}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-red-900/40 border border-red-800/50 p-5 min-h-[80px] active:scale-95 transition-transform"
              data-testid="floor-action-exit"
            >
              <HugeiconsIcon icon={ArrowUp01Icon} className="size-7 text-red-400" />
              <span className="text-sm font-medium text-red-300">Salida</span>
            </button>
            <button
              onClick={() => setActiveAction('transfer')}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-blue-900/40 border border-blue-800/50 p-5 min-h-[80px] active:scale-95 transition-transform"
              data-testid="floor-action-transfer"
            >
              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} className="size-7 text-blue-400" />
              <span className="text-sm font-medium text-blue-300">Mover</span>
            </button>
          </div>

          {/* Recent user actions */}
          <div className="px-4 space-y-2" data-testid="floor-recent-actions">
            <h3 className="text-sm font-medium text-muted-foreground">Tus ultimas acciones</h3>
            {loadingRecent ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full bg-muted rounded-lg" />
                <Skeleton className="h-10 w-full bg-muted rounded-lg" />
                <Skeleton className="h-10 w-full bg-muted rounded-lg" />
              </div>
            ) : recentActions.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">Sin movimientos recientes</p>
            ) : (
              recentActions.map((mov) => (
                <div
                  key={mov.id}
                  className="flex items-center gap-3 bg-card rounded-xl p-3 border border-border"
                >
                  <HugeiconsIcon icon={MOVEMENT_ICONS[mov.movement_type]} className={`size-5 ${MOVEMENT_COLORS[mov.movement_type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {mov.product_name}{' '}
                      {mov.movement_type === 'entry' && `→ ${mov.to_location_name ?? '—'}`}
                      {mov.movement_type === 'exit' && `← ${mov.from_location_name ?? '—'}`}
                      {mov.movement_type === 'transfer' &&
                        `${mov.from_location_name ?? '—'} → ${mov.to_location_name ?? '—'}`}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(mov.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product card component
// ---------------------------------------------------------------------------

function ProductCard({
  product,
  highlightLocations,
  onTap,
  onAction,
  isExpanded,
}: {
  product: ProductWithStock;
  highlightLocations?: boolean;
  onTap: (p: ProductWithStock) => void;
  onAction: (action: FloorAction, p: ProductWithStock) => void;
  isExpanded: boolean;
}) {
  const totalStock = product.inventory.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Card
      className="bg-card border-border active:border-primary transition-colors cursor-pointer"
      onClick={() => onTap(product)}
      data-testid={`product-card-${product.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{product.name}</h3>
            <p className="text-sm text-muted-foreground">{product.sku}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-foreground">{totalStock}</p>
            <p className="text-xs text-muted-foreground">{product.unit_of_measure}</p>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-border" data-testid="product-detail-expanded">
            {product.inventory.length > 0 ? (
              <div
                className={`grid ${product.inventory.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 mb-3`}
              >
                {product.inventory.map((inv) => (
                  <div
                    key={inv.id}
                    className={`text-sm rounded-lg p-2 ${
                      highlightLocations
                        ? 'bg-blue-900/30 border border-blue-800/50'
                        : 'bg-muted'
                    }`}
                  >
                    <span className="text-muted-foreground">{inv.location_name}:</span>{' '}
                    <span className="font-medium text-foreground">{inv.quantity}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">Sin inventario registrado</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-border text-foreground hover:bg-muted min-h-[44px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('entry', product);
                }}
                data-testid="product-action-entry"
              >
                Registrar entrada
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-border text-foreground hover:bg-muted min-h-[44px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('exit', product);
                }}
                data-testid="product-action-exit"
              >
                Registrar salida
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Simplified action form
// ---------------------------------------------------------------------------

function ActionForm({
  action,
  preselectedProduct,
  onClose,
  onSuccess,
}: {
  action: FloorAction;
  preselectedProduct: ProductWithStock | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [fromLocations, setFromLocations] = useState<Location[]>([]);

  const [productId, setProductId] = useState(preselectedProduct?.id ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Load products and warehouses
  useEffect(() => {
    api
      .get<Product[] | PaginatedResponse<Product>>('/products')
      .then((res) => setProducts(Array.isArray(res) ? res : res.data))
      .catch(() => {});
    api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => setWarehouses(Array.isArray(res) ? res : res.data))
      .catch(() => {});
  }, []);

  // Load locations when warehouse changes
  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }
    api
      .get<Location[] | PaginatedResponse<Location>>(`/warehouses/${warehouseId}/locations`)
      .then((res) => setLocations(Array.isArray(res) ? res : res.data))
      .catch(() => setLocations([]));
  }, [warehouseId]);

  // Load from-locations for transfers
  useEffect(() => {
    if (!fromWarehouseId || action !== 'transfer') {
      setFromLocations([]);
      return;
    }
    api
      .get<Location[] | PaginatedResponse<Location>>(`/warehouses/${fromWarehouseId}/locations`)
      .then((res) => setFromLocations(Array.isArray(res) ? res : res.data))
      .catch(() => setFromLocations([]));
  }, [fromWarehouseId, action]);

  const filteredProducts = productSearch
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(productSearch.toLowerCase())
      )
    : products;

  const handleSubmit = async () => {
    if (!productId || !quantity || Number(quantity) <= 0) {
      toast.error('Completa todos los campos');
      return;
    }

    setIsSubmitting(true);
    try {
      const movementType: MovementType =
        action === 'entry' ? 'entry' : action === 'exit' ? 'exit' : 'transfer';

      const body: Record<string, unknown> = {
        product_id: productId,
        quantity: Number(quantity),
        movement_type: movementType,
      };

      if (action === 'entry') {
        if (!locationId) {
          toast.error('Selecciona la ubicacion destino');
          setIsSubmitting(false);
          return;
        }
        body.to_location_id = locationId;
      } else if (action === 'exit') {
        if (!locationId) {
          toast.error('Selecciona la ubicacion origen');
          setIsSubmitting(false);
          return;
        }
        body.from_location_id = locationId;
      } else {
        if (!fromLocationId || !locationId) {
          toast.error('Selecciona origen y destino');
          setIsSubmitting(false);
          return;
        }
        body.from_location_id = fromLocationId;
        body.to_location_id = locationId;
      }

      await api.post('/movements', body);

      const actionLabel =
        action === 'entry' ? 'Entrada' : action === 'exit' ? 'Salida' : 'Transferencia';
      hapticFeedback('success');
      toast.success(`${actionLabel} registrada correctamente`);
      onSuccess();
    } catch (err) {
      hapticFeedback('error');
      toast.error(err instanceof Error ? err.message : 'Error al registrar movimiento');
    } finally {
      setIsSubmitting(false);
    }
  };

  const actionConfig = {
    entry: {
      title: 'Registrar entrada',
      icon: ArrowDown01Icon,
      iconColor: 'text-emerald-400',
      color: 'bg-emerald-900/30 border-emerald-800/50',
      buttonClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    },
    exit: {
      title: 'Registrar salida',
      icon: ArrowUp01Icon,
      iconColor: 'text-red-400',
      color: 'bg-red-900/30 border-red-800/50',
      buttonClass: 'bg-red-600 hover:bg-red-700 text-white',
    },
    transfer: {
      title: 'Mover material',
      icon: ArrowDataTransferHorizontalIcon,
      iconColor: 'text-blue-400',
      color: 'bg-blue-900/30 border-blue-800/50',
      buttonClass: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
  };

  const config = actionConfig[action];

  return (
    <div className="px-4 pb-4" data-testid="floor-action-form">
      <Card className={`border ${config.color} bg-card`}>
        <CardContent className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <HugeiconsIcon icon={config.icon} className={`size-5 ${config.iconColor}`} />
              {config.title}
            </h3>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-muted-foreground p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
              data-testid="floor-action-close"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-5" />
            </button>
          </div>

          {/* Product selector */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Producto</Label>
            {preselectedProduct ? (
              <div className="bg-muted rounded-xl p-3">
                <p className="font-medium text-foreground">{preselectedProduct.name}</p>
                <p className="text-xs text-muted-foreground">{preselectedProduct.sku}</p>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="bg-muted border-border text-foreground h-12"
                  data-testid="floor-product-search"
                />
                <Select value={productId || undefined} onValueChange={setProductId}>
                  <SelectTrigger
                    className="w-full bg-muted border-border text-foreground min-h-[48px]"
                    data-testid="floor-product-select"
                  >
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {/* Transfer: from location */}
          {action === 'transfer' && (
            <>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Almacen origen</Label>
                <Select value={fromWarehouseId || undefined} onValueChange={(v) => { setFromWarehouseId(v); setFromLocationId(''); }}>
                  <SelectTrigger
                    className="w-full bg-muted border-border text-foreground min-h-[48px]"
                    data-testid="floor-from-warehouse"
                  >
                    <SelectValue placeholder="Seleccionar almacen" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Ubicacion origen</Label>
                <Select
                  value={fromLocationId || undefined}
                  onValueChange={setFromLocationId}
                  disabled={!fromWarehouseId}
                >
                  <SelectTrigger
                    className="w-full bg-muted border-border text-foreground min-h-[48px]"
                    data-testid="floor-from-location"
                  >
                    <SelectValue placeholder={fromWarehouseId ? 'Seleccionar ubicacion' : 'Selecciona almacen primero'} />
                  </SelectTrigger>
                  <SelectContent>
                    {fromLocations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}{l.label ? ` (${l.label})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Destination / source warehouse + location */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {action === 'entry' ? 'Almacen destino' : action === 'exit' ? 'Almacen origen' : 'Almacen destino'}
            </Label>
            <Select value={warehouseId || undefined} onValueChange={(v) => { setWarehouseId(v); setLocationId(''); }}>
              <SelectTrigger
                className="w-full bg-muted border-border text-foreground min-h-[48px]"
                data-testid="floor-warehouse"
              >
                <SelectValue placeholder="Seleccionar almacen" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {action === 'entry' ? 'Ubicacion destino' : action === 'exit' ? 'Ubicacion origen' : 'Ubicacion destino'}
            </Label>
            <Select
              value={locationId || undefined}
              onValueChange={setLocationId}
              disabled={!warehouseId}
            >
              <SelectTrigger
                className="w-full bg-muted border-border text-foreground min-h-[48px]"
                data-testid="floor-location"
              >
                <SelectValue placeholder={warehouseId ? 'Seleccionar ubicacion' : 'Selecciona almacen primero'} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}{l.label ? ` (${l.label})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Cantidad</Label>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-16 text-3xl text-center font-bold bg-muted border-border text-foreground rounded-2xl"
              data-testid="floor-quantity"
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full min-h-[52px] text-base font-semibold rounded-2xl ${config.buttonClass}`}
            data-testid="floor-submit"
          >
            {isSubmitting ? 'Registrando...' : config.title}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
