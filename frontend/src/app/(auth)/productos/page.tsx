/**
 * app/(auth)/productos/page.tsx — thin orchestration shell for the
 * Productos LIST screen.
 *
 * See `frontend/src/CONVENTIONS.md` §2 (Zustand), §3 (SWR) and §7.1
 * (Migration pattern) plus `sdd/frontend-migration-productos/design` §2.1.
 *
 * Owns URL state (`tab`, `class`, `is_manufactured`) via `useSearchParams`
 * + `router.replace`. Subcomponents under `components/productos/` are
 * presentational and receive URL values + writers as props (STRUCT-7). The
 * LIST slice of `useProductosScreenStore` is cleared on unmount via the
 * FS-2.2 cleanup effect.
 */
'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CategoriesTab } from '@/components/productos/categories-tab';
import { ProductsTab } from '@/components/productos/products-tab';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useProductosScreenStore } from '@/features/productos/store';
import { useCategories } from '@/lib/hooks/use-categories';
import type { ProductClass } from '@/types';

function isProductClass(value: unknown): value is ProductClass {
  return (
    value === 'raw_material' || value === 'consumable' || value === 'tool_spare'
  );
}

function ProductosPageInner() {
  // NOTE: same caveat as `ordenes-de-trabajo/page.tsx` — do NOT destructure
  // `.get` off `searchParams`; `ReadonlyURLSearchParams` extends
  // `URLSearchParams` and `get` is an inherited prototype method that loses
  // `this` when destructured.
  const searchParams = useSearchParams();
  const { replace } = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') || 'productos';

  const rawClass = searchParams.get('class');
  const filterClass: ProductClass | null = isProductClass(rawClass)
    ? rawClass
    : null;
  const filterManufactured = searchParams.get('is_manufactured') === 'true';

  // FS-2.2 — reset the list slice when the page unmounts.
  useEffect(
    () => () => useProductosScreenStore.getState().resetList(),
    [],
  );

  const handleTabChange = (value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', value);
    replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const setFilterClass = useCallback(
    (next: ProductClass | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === null) {
        sp.delete('class');
      } else {
        sp.set('class', next);
      }
      const qs = sp.toString();
      replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, replace],
  );

  const setFilterManufactured = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next) {
        sp.set('is_manufactured', 'true');
      } else {
        sp.delete('is_manufactured');
      }
      const qs = sp.toString();
      replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, replace],
  );

  // Global categories — shared by both tabs (Products needs the lookup map
  // and the category filter dropdown; Categories needs the parent picker
  // and the parent-name renderer). SWR dedup means the network call fires
  // only once even though both tabs reference it.
  const { data: allCategories, refresh: refreshAllCategories } = useCategories();

  return (
    <div className="space-y-6" data-testid="productos-page">
      <div>
        <h1 className="text-2xl font-semibold">Productos</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona los productos y categorias de tu inventario
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="productos" data-testid="tab-productos">
            Productos
          </TabsTrigger>
          <TabsTrigger value="categorias" data-testid="tab-categorias">
            Categorias
          </TabsTrigger>
        </TabsList>

        <TabsContent value="productos">
          <ProductsTab
            categories={allCategories}
            filterClass={filterClass}
            filterManufactured={filterManufactured}
            setFilterClass={setFilterClass}
            setFilterManufactured={setFilterManufactured}
          />
        </TabsContent>

        <TabsContent value="categorias">
          <CategoriesTab
            allCategories={allCategories}
            onAllCategoriesInvalidate={refreshAllCategories}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ProductosPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <ProductosPageInner />
    </Suspense>
  );
}
