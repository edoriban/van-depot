'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Search01Icon,
  DashboardSquare01Icon,
  Store01Icon,
  Package01Icon,
  DeliveryTruck01Icon,
  ArrowDataTransferHorizontalIcon,
  ClipboardIcon,
  CheckListIcon,
  TaskDaily01Icon,
  Alert02Icon,
  Notification03Icon,
  Analytics01Icon,
  UserGroupIcon,
  ArrowRight01Icon,
  Loading03Icon,
} from '@hugeicons/core-free-icons';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { VisuallyHidden } from 'radix-ui';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-mutations';
import type { Product, Warehouse, Recipe, PaginatedResponse } from '@/types';

// ---------------------------------------------------------------------------
// Navigation items
// ---------------------------------------------------------------------------

interface NavResult {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: Parameters<typeof HugeiconsIcon>[0]['icon'];
}

const NAV_ITEMS: NavResult[] = [
  { id: 'nav-inicio', title: 'Inicio', href: '/inicio', icon: DashboardSquare01Icon },
  { id: 'nav-productos', title: 'Productos', href: '/productos', icon: Package01Icon },
  { id: 'nav-proveedores', title: 'Proveedores', href: '/proveedores', icon: DeliveryTruck01Icon },
  { id: 'nav-almacenes', title: 'Almacenes', href: '/almacenes', icon: Store01Icon },
  { id: 'nav-inventario', title: 'Inventario', href: '/inventario', icon: ClipboardIcon },
  { id: 'nav-movimientos', title: 'Movimientos', href: '/movimientos', icon: ArrowDataTransferHorizontalIcon },
  { id: 'nav-alertas', title: 'Alertas', href: '/alertas', icon: Alert02Icon },
  { id: 'nav-conteos', title: 'Conteos Ciclicos', href: '/conteos-ciclicos', icon: CheckListIcon },
  { id: 'nav-clasificacion', title: 'Clasificacion ABC', href: '/clasificacion-abc', icon: Analytics01Icon },
  { id: 'nav-usuarios', title: 'Usuarios', href: '/usuarios', icon: UserGroupIcon },
  { id: 'nav-notificaciones', title: 'Notificaciones', href: '/notificaciones', icon: Notification03Icon },
  { id: 'nav-recetas', title: 'Recetas', href: '/recetas', icon: TaskDaily01Icon },
];

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState<NavResult[]>([]);
  const [warehouses, setWarehouses] = useState<NavResult[]>([]);
  const [recipes, setRecipes] = useState<NavResult[]>([]);

  const { push } = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // openRef tracks the latest "open" state for the keydown handler so we can
  // do the reset-on-open inline (avoids the "useEffect simulating an event
  // handler" anti-pattern from react-doctor/no-effect-event-handler).
  const openRef = useRef(false);
  openRef.current = open;

  // Single entry point used by every opener (keyboard, button, Dialog onOpenChange).
  const handleOpenChange = useCallback((next: boolean) => {
    if (next) {
      setQuery('');
      setActiveIndex(0);
      setProducts([]);
      setWarehouses([]);
      setRecipes([]);
    }
    setOpen(next);
  }, []);

  // -- Keyboard shortcut (Cmd+K / Ctrl+K) --
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleOpenChange(!openRef.current);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenChange]);

  // -- API search --
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setProducts([]);
      setWarehouses([]);
      setRecipes([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function search() {
      try {
        const [prodRes, whRes, recRes] = await Promise.allSettled([
          api.get<PaginatedResponse<Product>>(`/products?search=${encodeURIComponent(debouncedQuery)}&per_page=5`),
          api.get<Warehouse[]>('/warehouses'),
          api.get<Recipe[]>('/recipes'),
        ]);

        if (cancelled) return;

        // Products
        if (prodRes.status === 'fulfilled') {
          const items = (prodRes.value.data ?? []).map((p) => ({
            id: `prod-${p.id}`,
            title: p.name,
            subtitle: p.sku,
            href: `/productos/${p.id}`,
            icon: Package01Icon,
          }));
          setProducts(items);
        }

        // Warehouses — client-side filter
        if (whRes.status === 'fulfilled') {
          const q = debouncedQuery.toLowerCase();
          const items = (whRes.value ?? [])
            .filter((w) => w.name.toLowerCase().includes(q) || (w.address ?? '').toLowerCase().includes(q))
            .slice(0, 5)
            .map((w) => ({
              id: `wh-${w.id}`,
              title: w.name,
              subtitle: w.address,
              href: `/almacenes/${w.id}`,
              icon: Store01Icon,
            }));
          setWarehouses(items);
        }

        // Recipes — client-side filter
        if (recRes.status === 'fulfilled') {
          const q = debouncedQuery.toLowerCase();
          const items = (recRes.value ?? [])
            .filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
            .slice(0, 5)
            .map((r) => ({
              id: `rec-${r.id}`,
              title: r.name,
              subtitle: r.description ?? undefined,
              href: `/recetas/${r.id}`,
              icon: TaskDaily01Icon,
            }));
          setRecipes(items);
        }
      } catch {
        // Silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    search();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // -- Build flat list of all results --
  const q = query.toLowerCase();
  const filteredNav = query.length > 0
    ? NAV_ITEMS.filter((item) => item.title.toLowerCase().includes(q))
    : NAV_ITEMS;

  interface ResultGroup {
    label: string;
    items: NavResult[];
  }

  const groups: ResultGroup[] = [];
  if (filteredNav.length > 0) groups.push({ label: 'Navegacion', items: filteredNav });
  if (products.length > 0) groups.push({ label: 'Productos', items: products });
  if (warehouses.length > 0) groups.push({ label: 'Almacenes', items: warehouses });
  if (recipes.length > 0) groups.push({ label: 'Recetas', items: recipes });

  const flatItems = groups.flatMap((g) => g.items);

  // -- Navigate to item --
  const navigate = useCallback(
    (item: NavResult) => {
      setOpen(false);
      push(item.href);
    },
    [push],
  );

  // -- Keyboard navigation --
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(flatItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + flatItems.length) % Math.max(flatItems.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) navigate(item);
    }
  }

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query, products.length, warehouses.length, recipes.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // -- Render --
  let itemCounter = -1;

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Buscar"
      >
        <HugeiconsIcon icon={Search01Icon} size={16} />
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="pointer-events-none hidden select-none rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
          {typeof navigator !== 'undefined' && /Mac|iPhone/.test(navigator.userAgent ?? '') ? '\u2318K' : 'Ctrl+K'}
        </kbd>
      </button>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <VisuallyHidden.Root>
            <DialogTitle>Busqueda global</DialogTitle>
          </VisuallyHidden.Root>

          {/* Search input */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <HugeiconsIcon icon={Search01Icon} size={18} className="shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar productos, paginas, recetas..."
              // react-doctor: autoFocus retained for dialog focus management
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <HugeiconsIcon icon={Loading03Icon} size={16} className="shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[min(60vh,400px)] overflow-y-auto overscroll-contain py-2">
            {flatItems.length === 0 && query.length > 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No se encontraron resultados.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    itemCounter++;
                    const idx = itemCounter;
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-active={isActive}
                        onClick={() => navigate(item)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/50',
                        )}
                      >
                        <HugeiconsIcon icon={item.icon} size={18} className="shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{item.title}</span>
                          {item.subtitle && (
                            <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>
                          )}
                        </div>
                        {isActive && (
                          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hints */}
          <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">&uarr;&darr;</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
              abrir
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
              cerrar
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
