/**
 * components/productos/products-tab.tsx — Productos tab content
 * (filters + table + dialogs) for the productos LIST page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-productos/spec` PROD-LIST-INV-1, INV-4, INV-5,
 * INV-6, INV-8.
 *
 * URL-bound filters (`?class=`, `?is_manufactured=`) come down as props
 * from the page shell (STRUCT-7). Local filters (`search`,
 * `filterCategoryId`) stay as local `useState` because they have no URL
 * contract today (design §2.1 LOCKED — preserve current behavior). Server
 * data flows through `useProducts(filters)`.
 *
 * Testids preserved verbatim: `new-product-btn`, `search-input`,
 * `category-filter`, `product-detail-link`, `product-class-badge`,
 * `product-manufactured-badge`, `edit-product-btn`, `delete-product-btn`.
 */
'use client';

import { useState } from 'react';
import { Package01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { useProductosScreenStore } from '@/features/productos/store';
import { useProducts } from '@/lib/hooks/use-products';
import type { Category, ProductClass } from '@/types';
import { ProductClassChipRow } from './product-class-chip-row';
import { ProductCreateEditDialog } from './product-create-edit-dialog';
import { ProductDeleteConfirm } from './product-delete-confirm';
import { buildProductColumns } from './product-row-columns';

const PER_PAGE = 20;

interface ProductsTabProps {
  categories: Category[];
  filterClass: ProductClass | null;
  filterManufactured: boolean;
  setFilterClass: (next: ProductClass | null) => void;
  setFilterManufactured: (next: boolean) => void;
}

export function ProductsTab({
  categories,
  filterClass,
  filterManufactured,
  setFilterClass,
  setFilterManufactured,
}: ProductsTabProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');

  const openCreateDialog = useProductosScreenStore((s) => s.openCreateProduct);
  const openEditDialog = useProductosScreenStore((s) => s.openEditProduct);
  const setDeleteTarget = useProductosScreenStore(
    (s) => s.setDeleteTargetProduct,
  );

  const {
    data: products,
    total,
    isLoading,
    error: fetchError,
    refresh,
  } = useProducts({
    page,
    per_page: PER_PAGE,
    search: search || undefined,
    category_id: filterCategoryId || undefined,
    product_class: filterClass ?? undefined,
    is_manufactured: filterManufactured ? true : undefined,
  });

  const errorMessage =
    fetchError instanceof Error ? fetchError.message : null;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleCategoryFilterChange = (value: string) => {
    setFilterCategoryId(value);
    setPage(1);
  };

  const handleClassChipChange = (next: ProductClass | null) => {
    setFilterClass(next);
    setPage(1);
  };

  const handleManufacturedToggle = () => {
    setFilterManufactured(!filterManufactured);
    setPage(1);
  };

  const handleSaved = () => {
    setPage(1);
    void refresh();
  };

  const columns = buildProductColumns({
    categories,
    onEdit: openEditDialog,
    onDelete: setDeleteTarget,
  });

  return (
    <div className="space-y-4">
      <ProductClassChipRow
        filterClass={filterClass}
        filterManufactured={filterManufactured}
        onClassChange={handleClassChipChange}
        onManufacturedToggle={handleManufacturedToggle}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="max-w-sm"
            data-testid="search-input"
          />
          <SearchableSelect
            value={filterCategoryId || 'all'}
            onValueChange={(val) =>
              handleCategoryFilterChange(val === 'all' ? '' : val)
            }
            options={[
              { value: 'all', label: 'Todas las categorias' },
              ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
            ]}
            placeholder="Todas las categorias"
            searchPlaceholder="Buscar categoria..."
            className="max-w-xs"
          />
        </div>
        <Button onClick={openCreateDialog} data-testid="new-product-btn">
          Nuevo producto
        </Button>
      </div>

      {errorMessage && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <DataTable
        columns={columns}
        data={products}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay productos registrados"
        emptyState={
          <EmptyState
            icon={Package01Icon}
            title="Aun no tienes productos registrados"
            description="Agrega tu primer producto para empezar a controlar tu stock."
            actionLabel="Nuevo producto"
            onAction={openCreateDialog}
          />
        }
      />

      <ProductCreateEditDialog
        categories={categories}
        onSaved={handleSaved}
      />

      <ProductDeleteConfirm onDeleted={refresh} />
    </div>
  );
}
