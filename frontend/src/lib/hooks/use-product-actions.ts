/**
 * lib/hooks/use-product-actions.ts — typed mutation bundle for the
 * productos LIST + DETAIL pages.
 *
 * See `frontend/src/CONVENTIONS.md` §3 (SWR) and §7.1 (Migration pattern).
 * Design `sdd/frontend-migration-productos/design` §4.6 LOCKED: ONE bundle,
 * NOT split per entity (products + categories share the same screen state
 * so a single bundle mirrors `useWorkOrderActions`).
 *
 * Each mutation wraps the corresponding `api.post/put/del` and invalidates
 * the relevant SWR cache via `mutate(...)` so consumers re-fetch on next
 * mount (and any active matching key revalidates immediately).
 *
 * `reclassifyProduct` delegates to the existing
 * `reclassifyProduct` mutation in `@/lib/api-mutations` to avoid network-
 * code duplication.
 */
'use client';

import { mutate as globalMutate } from 'swr';
import { api, reclassifyProduct as apiReclassifyProduct } from '@/lib/api-mutations';
import type { Category, Product, ProductClass } from '@/types';
import type {
  CategoryFormInput,
  CreateProductInput,
  EditProductInput,
} from '@/features/productos/schema';

export interface UseProductActionsResult {
  createProduct: (input: CreateProductInput) => Promise<Product>;
  updateProduct: (id: string, input: EditProductInput) => Promise<Product>;
  deleteProduct: (id: string) => Promise<void>;
  reclassifyProduct: (id: string, choice: ProductClass) => Promise<Product>;
  createCategory: (input: CategoryFormInput) => Promise<Category>;
  updateCategory: (id: string, input: CategoryFormInput) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
}

/**
 * Invalidate every active SWR key whose URL starts with the given prefix.
 * Use this so paginated/filtered list views (e.g.
 * `/products?page=2&per_page=20&class=raw_material`) all revalidate after
 * a mutation without hardcoding every filter combination.
 */
function invalidatePrefix(prefix: string): Promise<unknown> {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    undefined,
    { revalidate: true },
  );
}

function buildProductPayload(input: CreateProductInput | EditProductInput): Record<string, unknown> {
  // Apply the tool_spare → has_expiry=false invariant at the payload
  // boundary. This mirrors the current page's coercion at submit-time so
  // the API never receives an illegal combo.
  const productClass = 'productClass' in input ? input.productClass : undefined;
  const isManufactured =
    'isManufactured' in input ? input.isManufactured : undefined;

  const has_expiry = productClass === 'tool_spare' ? false : input.hasExpiry;
  // Only raw_material can be manufactured. For edits we don't send the
  // field at all (class is reclassify-only on edit).
  const payload: Record<string, unknown> = {
    name: input.name,
    sku: input.sku,
    description: input.description,
    category_id: input.categoryId,
    unit_of_measure: input.unit,
    has_expiry,
    min_stock: input.minStock,
    max_stock: input.maxStock,
  };

  if (productClass !== undefined) {
    payload.product_class = productClass;
    payload.is_manufactured =
      productClass === 'raw_material' ? Boolean(isManufactured) : false;
  }

  if ('isActive' in input) {
    payload.is_active = input.isActive;
  }

  return payload;
}

export function useProductActions(): UseProductActionsResult {
  return {
    createProduct: async (input) => {
      const payload = buildProductPayload(input);
      const created = await api.post<Product>('/products', payload);
      await invalidatePrefix('/products');
      return created;
    },
    updateProduct: async (id, input) => {
      const payload = buildProductPayload(input);
      const updated = await api.put<Product>(`/products/${id}`, payload);
      await Promise.all([
        invalidatePrefix('/products'),
        globalMutate(`/products/${id}`),
      ]);
      return updated;
    },
    deleteProduct: async (id) => {
      await api.del<void>(`/products/${id}`);
      await invalidatePrefix('/products');
    },
    reclassifyProduct: async (id, choice) => {
      const updated = await apiReclassifyProduct(id, choice);
      await Promise.all([
        invalidatePrefix('/products'),
        globalMutate(`/products/${id}`),
      ]);
      return updated;
    },
    createCategory: async (input) => {
      const created = await api.post<Category>('/categories', {
        name: input.name,
        parent_id: input.parentId,
      });
      await invalidatePrefix('/categories');
      return created;
    },
    updateCategory: async (id, input) => {
      const updated = await api.put<Category>(`/categories/${id}`, {
        name: input.name,
        parent_id: input.parentId,
      });
      await invalidatePrefix('/categories');
      return updated;
    },
    deleteCategory: async (id) => {
      await api.del<void>(`/categories/${id}`);
      await invalidatePrefix('/categories');
    },
  };
}
