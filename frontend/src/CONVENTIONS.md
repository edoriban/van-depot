# Frontend Conventions (`frontend/src/CONVENTIONS.md`)

Authoritative rules for **new** frontend code in `van-depot`. Existing code under
`frontend/src/app/(auth)/{productos,recetas,almacenes,proveedores,movimientos,ordenes-de-trabajo}/`
is **out of scope** until a future `frontend-migration` change — see §7 below.

> **Source of truth.** This document is referenced by `.atl/skill-registry.md`
> so SDD apply-phase sub-agents auto-load it before writing frontend code.
> Each new primitive ships with a JSDoc back-pointer to the relevant section
> here. Origin: SDD change `frontend-standardization` (engram observations
> #441 / #443 / #445).

## JSDoc back-pointer pattern

Every new primitive source file MUST start with a JSDoc comment whose first
non-blank line points back to a section of this document. Copy this template:

```ts
/**
 * lib/foo.ts — what this file does.
 *
 * See `frontend/src/CONVENTIONS.md` §<section number> (<section title>).
 */
```

A reviewer running `head -30 path/to/primitive.ts | grep -F 'CONVENTIONS.md'`
MUST see a hit. This is enforced by spec FS-5.3.

---

## 1. Validation with Zod

We use **Zod v4** for runtime validation of every user-facing input boundary
in new code (forms, dialogs, command surfaces, `URLSearchParams` parsing).

**Rules:**

- **FS-1.1.** Every new form / dialog / command surface MUST define a Zod
  schema and run `schema.safeParse(formStateObject)` on submit. Submission
  MUST be blocked when parsing fails. Inline ad-hoc checks like
  `Number(x)` or `x.trim() !== ''` at submit time are PROHIBITED in new
  code.
- **FS-1.2.** Schema home rules:
  - Domain-scoped schemas (tied to a single feature) live at
    `frontend/src/features/{domain}/schema.ts`.
  - Cross-cutting Zod primitives (id brands, pagination, common date
    ranges) live under `frontend/src/lib/schemas/`.
  - New code MUST NOT define a schema inline at the top of a page file.
  - **Do not pre-create empty `features/{domain}/schema.ts` files.** The
    first real caller creates the file.
- **FS-1.3.** Always export `type CreateXInput = z.infer<typeof xSchema>`
  alongside the schema. New code MUST NOT also declare a hand-written
  `interface CreateXInput { ... }` that duplicates fields the schema
  describes.
- **FS-1.4.** **No `react-hook-form`.** Default strategy = controlled
  inputs + Zod parse on submit. Future changes MAY revisit this rule
  per-feature when a real need (field arrays, dirty tracking, async
  field-level validation) emerges.

### Domain schema with `superRefine` cross-field check

```ts
// frontend/src/features/sales-orders/schema.ts
import { z } from 'zod';
import { idSchema } from '@/lib/schemas/id';

export const salesOrderCreateSchema = z
  .object({
    customer_id: idSchema,
    requested_at: z.coerce.date(),
    notes: z.string().trim().max(500).optional(),
    lines: z
      .array(
        z.object({
          product_id: idSchema,
          quantity: z.coerce.number().positive(),
        }),
      )
      .min(1, 'Agrega al menos una línea'),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.lines.forEach((line, idx) => {
      if (seen.has(line.product_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', idx, 'product_id'],
          message: 'Producto repetido en la orden',
        });
      }
      seen.add(line.product_id);
    });
  });

export type CreateSalesOrderInput = z.infer<typeof salesOrderCreateSchema>;
```

### `parseFormData<T>` recipe (copy-paste, do NOT extract to a module)

When you need a uniform `{ ok, data | errors }` shape from a `safeParse`,
inline this helper into your feature module. We deliberately do NOT ship it
as a shared module — extracting it would be premature primitive lock-in
(see §6 below).

```ts
import { z } from 'zod';

export function parseFormData<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.map(String).join('.');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
```

---

## 2. State management with Zustand

**Rules:**

- **FS-2.1.** Extract a screen-scoped Zustand store when ANY of the
  following hold:
  - A single component file accumulates >5 `useState` calls describing
    one logical screen state (form draft, filter set, dialog visibility).
  - 2+ child components share the same state and the parent passes 4+
    props to coordinate them.
  - A nested helper component takes 8+ props (the `WarehouseLocationSelector`
    smell in `movimientos/page.tsx`).

  The store MUST be defined at `frontend/src/features/{domain}/store.ts`
  and exported as `use{Domain}ScreenStore`. Do not pre-create stores for
  features without a real caller.

- **FS-2.2.** Per-route reset is the default. Every screen-scoped store
  MUST expose a `reset()` action and the consuming route MUST call it on
  unmount via `useEffect(() => () => use{Domain}ScreenStore.getState().reset(), [])`.
  Singletons (auth, theme, current warehouse) need a one-line JSDoc
  justification above their `create()` call.

- **FS-2.3.** New stores MUST be wrapped in `devtools` middleware gated
  by `process.env.NODE_ENV !== 'production'` (production builds strip the
  middleware). The `name` passed to `devtools` MUST match the export name.

- **FS-2.4.** **`persist` is OFF by default.** Add `persist(...)` only
  with a JSDoc comment justifying why the state should survive reloads
  (e.g. "auth token rehydrates across reloads"). The default for
  screen-scoped stores is non-persistent.

- **FS-2.5.** Use this **decision rule** when picking a state container:
  1. **Server-owned data?** (lists, lookups, detail fetches the backend
     owns) → SWR via `useResourceList<T>` (§3). Never copy server data
     into a Zustand store.
  2. **Cross-component screen state?** (form drafts shared by 2+
     components, filter sets, dialog flags coordinated across the page,
     OR a single component file that has crossed the FS-2.1 thresholds)
     → Zustand screen-scoped store.
  3. **Hyper-local UI state?** (one component's popover open flag,
     hover index, transient label) → `useState`.

  Tiebreaker: when in doubt, start with `useState` and graduate to a
  store on the **second copy** of the same state (see §6).

### Worked screen-scoped store

```ts
// frontend/src/features/sales-orders/store.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SalesOrdersScreenState {
  customerId: string;
  notes: string;
  lines: Array<{ product_id: string; quantity: string }>;
  isFormOpen: boolean;
  setCustomerId: (id: string) => void;
  setNotes: (notes: string) => void;
  addLine: () => void;
  setFormOpen: (open: boolean) => void;
  reset: () => void;
}

const initial = {
  customerId: '',
  notes: '',
  lines: [{ product_id: '', quantity: '' }],
  isFormOpen: false,
};

export const useSalesOrdersScreenStore = create<SalesOrdersScreenState>()(
  devtools(
    (set) => ({
      ...initial,
      setCustomerId: (customerId) => set({ customerId }),
      setNotes: (notes) => set({ notes }),
      addLine: () =>
        set((s) => ({ lines: [...s.lines, { product_id: '', quantity: '' }] })),
      setFormOpen: (isFormOpen) => set({ isFormOpen }),
      reset: () => set(initial),
    }),
    {
      name: 'useSalesOrdersScreenStore',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
```

### Per-route teardown

```tsx
'use client';
import { useEffect } from 'react';
import { useSalesOrdersScreenStore } from './store';

export default function SalesOrdersPage() {
  useEffect(() => () => useSalesOrdersScreenStore.getState().reset(), []);
  // ... render ...
}
```

For an example of the (rare) persist-with-justification pattern, see
`frontend/src/stores/auth-store.ts` (auth token rehydration on reload).

---

## 3. Data fetching with SWR

**Rules:**

- **FS-3.1.** New list / lookup reads MUST use `useResourceList<T>` from
  `@/lib/hooks/use-resource-list`. The hook applies `unwrapList<T>`
  internally so callers never write `Array.isArray(res) ? res : res.data`
  themselves.
- **FS-3.2.** One-shot mutations (POST / PUT / PATCH / DELETE) live in
  `frontend/src/lib/api-mutations.ts` (or feature-scoped equivalents) and
  MUST NOT be wrapped in SWR. Mutations MAY call `mutate(key)` from
  `swr` after success to invalidate any active `useResourceList` cache.

### Worked list-page sample

```tsx
'use client';
import { useResourceList } from '@/lib/hooks/use-resource-list';
import type { Product } from '@/types';

export function ProductsList() {
  const { data: products, isLoading, error, refresh } =
    useResourceList<Product>('/products');

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBox onRetry={refresh} />;
  return <DataTable rows={products} />;
}
```

### Cache-key convention

- Bare path `/products` is its own key.
- Path + query `/locations` with `{ warehouse_id: 'abc' }` becomes the
  cache key `/locations?warehouse_id=abc`. Two consumers passing the same
  `(path, query)` share one network request via SWR dedup.
- For mutation-driven invalidation: `import { mutate } from 'swr'; mutate('/products');`.
- Pass `path = null` to make the hook inert (no fetch, returns `[]`).

The existing 7 SWR usages (notifications panel, warehouse map, almacenes
detail) **continue to use `useSWR` directly** in this change — migration
is the responsibility of the future `frontend-migration` change. Scope
guardrail FS-6.1 forbids editing those files here.

---

## 4. Reusable primitives catalog

| Primitive | Path | Signature |
|---|---|---|
| `unwrapList<T>(res)` | `lib/api.ts` | `(res: unknown) => T[]` |
| `surfaceApiError(err, opts?)` | `lib/api.ts` | `(err: unknown, opts?) => void` |
| `useResourceList<T>(path, query?, swrOptions?)` | `lib/hooks/use-resource-list.ts` | `=> { data, isLoading, error, refresh }` |
| `<FormField>` | `components/form-field/` | `{ label, htmlFor, error?, description?, required?, className?, children }` |
| `<StatusBadge>` | `components/status-badge/` | `{ variant, value, className? }` |
| `idSchema` / `Id` | `lib/schemas/id.ts` | branded UUID Zod schema |
| `paginationQuerySchema` / `PaginationQuery` | `lib/schemas/pagination.ts` | `{ page, limit }` Zod schema |

### `unwrapList<T>`

```ts
import { unwrapList } from '@/lib/api';
const products = unwrapList<Product>(rawResponse);
```

- **Use when** a list-fetch endpoint may return either a raw `T[]` or a
  paginated envelope `{ data: T[] }`. The helper normalizes both shapes
  and returns `[]` for unknown shapes (never throws).
- **Don't use when** the response is known to be a single record (use
  the typed mutation/fetch helpers in `lib/api-mutations.ts` instead).

### `surfaceApiError`

```ts
try { await createWorkOrder(input); }
catch (err) {
  surfaceApiError(err, {
    codeMap: { INSUFFICIENT_STOCK: 'Stock insuficiente' },
    fallback: 'No se pudo crear la orden',
  });
}
```

- **Use when** a UI handler's `catch` block should surface a Spanish
  toast for any thrown value. Integrates directly with `sonner`.
- **Don't use when** the caller needs the message string (returns
  `void`), or for log-only paths that should not toast.

### `useResourceList<T>`

```tsx
const { data, isLoading, error, refresh } =
  useResourceList<Supplier>('/suppliers');
```

- **Use when** fetching any list / lookup collection. `path = null` is
  inert; pass query params via the second arg.
- **Don't use when** wrapping a one-shot mutation (mutations live in
  `lib/api-mutations.ts`, never inside `useSWR`).

### `<FormField>`

```tsx
<FormField label="Nombre" htmlFor="name" error={errors.name} required>
  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
</FormField>
```

- **Use when** rendering a label + control + error/description triple in
  a new form. Caller MUST match the inner control's `id` to `htmlFor`.
- **Don't use when** rendering a non-form label (use `<Label>` directly
  from `@/components/ui/label`).

### `<StatusBadge>`

```tsx
<StatusBadge variant="movement" value={m.movement_type} />
<StatusBadge variant="wo_status" value={wo.status} />
```

- **Use when** displaying a tone-coded enum value (movement type, WO
  status, product class, movement reason).
- **Don't use when** rendering an arbitrary text badge — use `<Badge>`
  from `@/components/ui/badge` directly.

---

## 5. Folder layout

```
frontend/src/
├── lib/
│   ├── api.ts                    ← non-mutation helpers (unwrapList, surfaceApiError)
│   ├── api-mutations.ts          ← typed mutation endpoints (POST/PUT/PATCH/DELETE)
│   ├── hooks/
│   │   └── use-resource-list.ts  ← canonical SWR list/lookup primitive
│   └── schemas/                  ← cross-cutting Zod primitives
│       ├── id.ts
│       └── pagination.ts
├── components/
│   ├── form-field/               ← reusable presentational primitive
│   ├── status-badge/             ← reusable presentational primitive (+ registry)
│   └── ui/                       ← shadcn-generated primitives
├── features/                     ← per-domain feature folders (created on first real caller)
│   └── {domain}/
│       ├── schema.ts             ← Zod schema + inferred input types
│       ├── store.ts              ← screen-scoped Zustand store
│       └── hooks.ts              ← feature SWR/mutation wrappers
└── CONVENTIONS.md                ← this document
```

**Rules:**

- `features/{domain}/{schema,store,hooks}.ts` are created by the FIRST
  real caller. **Do not** pre-create empty files for domains with no
  caller (FS-1.2, FS-2.1).
- Cross-cutting reusable primitives graduate from a feature folder to
  `lib/` or `components/<primitive>/` when a **second** consumer appears
  (see §6).

```ts
// Example: `features/sales-orders/` populated by its first real caller.
// frontend/src/features/sales-orders/
//   schema.ts   — salesOrderCreateSchema + CreateSalesOrderInput
//   store.ts    — useSalesOrdersScreenStore
//   hooks.ts    — useSalesOrders (wraps useResourceList<SalesOrder>('/sales-orders'))
```

---

## 6. Dedupe heuristic — extract on second copy

The rule: **tolerate the first copy, extract on the second.** When you
catch yourself writing the same snippet a second time, lift it into a
feature module or a cross-cutting primitive.

```tsx
// First copy — fine. Don't extract yet.
function ProductsPage() {
  const { data, error } = useSWR<Product[] | { data: Product[] }>('/products');
  const list = Array.isArray(data) ? data : (data?.data ?? []);
  // ...
}

// Second copy elsewhere — extract NOW. The `unwrapList<T>` primitive
// (or `useResourceList<T>` for the full SWR boilerplate) is the answer.
function SuppliersPage() {
  const { data: list } = useResourceList<Supplier>('/suppliers');
  // ...
}
```

Premature extraction (a primitive with one consumer) rots faster than
duplication. Wait for the duplication signal, then extract.

---

## 7. Migration boundary

This change (`frontend-standardization`) is **convention-only**. The
following 6 page directories are **out of scope** and MUST NOT be modified:

- `frontend/src/app/(auth)/productos/`
- `frontend/src/app/(auth)/recetas/`
- `frontend/src/app/(auth)/almacenes/`
- `frontend/src/app/(auth)/proveedores/`
- `frontend/src/app/(auth)/movimientos/`
- `frontend/src/app/(auth)/ordenes-de-trabajo/`

These pages keep their controlled-vanilla forms (the
`frontend_forms_controlled_vanilla` deviation accepted in
`work-orders-and-bom` archive obs #388 §3 deviation #2) until a future
SDD change named `frontend-migration` retrofits them onto these
conventions. Until then, **new code** governs by §1–§6 of this document
while the 6 pages continue to satisfy the `main-spec/frontend` baseline.

```ts
// New code under frontend/src/features/sales-orders/  → MUST follow this doc.
// Edits under frontend/src/app/(auth)/productos/page.tsx → BLOCKED until frontend-migration.
```
