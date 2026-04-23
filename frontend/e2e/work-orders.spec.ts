import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Work orders + BOM E2E coverage (spec §8.1–§8.5 of work-orders-and-bom).
 *
 * Shared context:
 * - The 8.1 → 8.2 → 8.3 chain is serial because 8.2 depends on the WO
 *   created in 8.1, and 8.3 depends on the issue from 8.2. We cache the
 *   WO code + id in module-level `chain` state.
 * - 8.4 (insufficient stock) is self-contained: it provisions a dedicated
 *   test warehouse + SKU prefix via the backend API so it never collides
 *   with 8.1-8.3 or the persistent dev seed.
 * - 8.5 creates its own WO (independent of the chain) and walks it
 *   through issue → cancel to assert reversal movements surface.
 *
 * Invocation: `pnpm exec playwright test work-orders.spec.ts --workers=1`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

// ──────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────

async function apiLogin(
  request: APIRequestContext,
): Promise<{ token: string }> {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: 'admin@vandev.mx', password: 'admin123' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { access_token: string };
  return { token: body.access_token };
}

async function apiGet<T>(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<T> {
  const res = await request.get(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json() as Promise<T>;
}

/**
 * Normalize endpoints that may return either a raw array or the
 * `PaginatedResponse<T>` envelope. Every list endpoint in this API uses the
 * envelope, but older ones (warehouse-scoped locations) historically
 * returned arrays — handle both transparently.
 */
function unwrapList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && 'data' in res) {
    return (res as { data: T[] }).data;
  }
  return [];
}

async function apiPost<T = unknown>(
  request: APIRequestContext,
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await request.post(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: body ?? {},
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json() as Promise<T>;
}

interface SeedIds {
  warehouseId: string;
  storageLocationId: string;
  workCenterId: string;
  fgProductId: string;
  fgProductSku: string;
  ingredientId: string;
  recipeId: string;
}

/**
 * Resolve (or create) the ambient seed — warehouse with a work-center, a
 * manufacturable FG, one ingredient, and a recipe linking them. Idempotent
 * for the test run: if the SKUs already exist we reuse them. Uses the
 * timestamp in names/descriptions to avoid colliding across runs.
 */
async function ensureSeedForChain(
  request: APIRequestContext,
  token: string,
): Promise<SeedIds> {
  const stamp = Date.now();
  // Find or create a warehouse with a work-center. "Almacén Principal" from
  // the dev seed already has one; we reuse it if present.
  const whRaw = await apiGet<unknown>(
    request,
    token,
    '/warehouses?per_page=200',
  );
  const warehouses = unwrapList<{ id: string; name: string }>(whRaw);
  const primary =
    warehouses.find((w) => w.name.includes('Principal')) ?? warehouses[0];
  expect(primary, 'at least one warehouse must exist').toBeDefined();
  const warehouseId = primary.id;

  const locsRaw = await apiGet<unknown>(
    request,
    token,
    `/warehouses/${warehouseId}/locations`,
  );
  const locs = unwrapList<{
    id: string;
    name: string;
    location_type: string;
  }>(locsRaw);
  const workCenter = locs.find((l) => l.location_type === 'work_center');
  expect(workCenter, 'warehouse must have a work_center seeded').toBeDefined();
  // Storage source for the ingredient inventory. Any non-system, non-work
  // location works; we pick the first "storage"-like row.
  let storage = locs.find(
    (l) =>
      l.location_type !== 'work_center' &&
      l.location_type !== 'finished_good' &&
      l.location_type !== 'reception',
  );
  if (!storage) {
    const created = await apiPost<{ id: string }>(
      request,
      token,
      `/warehouses/${warehouseId}/locations`,
      {
        name: `E2E Storage ${stamp}`,
        location_type: 'storage',
      },
    );
    storage = {
      id: created.id,
      name: `E2E Storage ${stamp}`,
      location_type: 'storage',
    };
  }

  // Create FG + ingredient. Unique SKU per run guarantees no collisions.
  const fgSku = `E2E-FG-${stamp}`;
  const ingSku = `E2E-ING-${stamp}`;
  const fg = await apiPost<{ id: string; sku: string }>(
    request,
    token,
    '/products',
    {
      name: `E2E FG ${stamp}`,
      sku: fgSku,
      unit_of_measure: 'piece',
      product_class: 'raw_material',
      has_expiry: false,
      is_manufactured: true,
      min_stock: 0,
    },
  );
  const ing = await apiPost<{ id: string }>(request, token, '/products', {
    name: `E2E Ingredient ${stamp}`,
    sku: ingSku,
    unit_of_measure: 'piece',
    product_class: 'raw_material',
    has_expiry: false,
    min_stock: 0,
  });

  // Seed the ingredient inventory at the storage location so issue + complete
  // have source material to move. 100 units is more than enough for the 2 the
  // recipe requires.
  await apiPost(request, token, '/movements/entry', {
    product_id: ing.id,
    to_location_id: storage.id,
    quantity: 100,
    notes: 'E2E ingredient seed',
  });

  const recipe = await apiPost<{ recipe: { id: string } }>(
    request,
    token,
    '/recipes',
    {
      name: `E2E Recipe ${stamp}`,
      description: `Auto-created for work-orders.spec run ${stamp}`,
      items: [{ product_id: ing.id, quantity: 2 }],
    },
  );

  return {
    warehouseId,
    storageLocationId: storage.id,
    workCenterId: workCenter!.id,
    fgProductId: fg.id,
    fgProductSku: fgSku,
    ingredientId: ing.id,
    recipeId: recipe.recipe.id,
  };
}

/** Seed a scenario where the work-center is guaranteed short of one material. */
async function ensureShortStockScenario(
  request: APIRequestContext,
  token: string,
): Promise<SeedIds & { shortfall: number }> {
  const stamp = Date.now();
  const whRaw = await apiGet<unknown>(
    request,
    token,
    '/warehouses?per_page=200',
  );
  const warehouses = unwrapList<{ id: string; name: string }>(whRaw);
  const primary =
    warehouses.find((w) => w.name.includes('Principal')) ?? warehouses[0];
  const warehouseId = primary.id;
  const locsRaw = await apiGet<unknown>(
    request,
    token,
    `/warehouses/${warehouseId}/locations`,
  );
  const locs = unwrapList<{
    id: string;
    name: string;
    location_type: string;
  }>(locsRaw);
  const workCenter = locs.find((l) => l.location_type === 'work_center');
  expect(workCenter).toBeDefined();
  const storage =
    locs.find(
      (l) =>
        l.location_type !== 'work_center' &&
        l.location_type !== 'finished_good' &&
        l.location_type !== 'reception',
    ) ?? locs[0];

  const fgSku = `E2E-SHORT-FG-${stamp}`;
  const ingSku = `E2E-SHORT-ING-${stamp}`;
  const fg = await apiPost<{ id: string }>(request, token, '/products', {
    name: `E2E Short FG ${stamp}`,
    sku: fgSku,
    unit_of_measure: 'piece',
    product_class: 'raw_material',
    has_expiry: false,
    is_manufactured: true,
    min_stock: 0,
  });
  const ing = await apiPost<{ id: string }>(request, token, '/products', {
    name: `E2E Short Ing ${stamp}`,
    sku: ingSku,
    unit_of_measure: 'piece',
    product_class: 'raw_material',
    has_expiry: false,
    min_stock: 0,
  });
  // Seed 10 units at storage so the WO can be ISSUED successfully (issue
  // moves all required material storage → work_center). After issue, we
  // manually exit 2 units from the work_center to simulate loss/theft, so
  // the work_center is left with 8 units while the BOM expects 10 — the
  // complete call then must surface 409 with shortfall=2. This mirrors the
  // 6.10 backend integration test's "starve after issue" pattern.
  await apiPost(request, token, '/movements/entry', {
    product_id: ing.id,
    to_location_id: storage.id,
    quantity: 10,
    notes: 'E2E short-stock seed (issue source)',
  });
  const recipe = await apiPost<{ recipe: { id: string } }>(
    request,
    token,
    '/recipes',
    {
      name: `E2E Short Recipe ${stamp}`,
      items: [{ product_id: ing.id, quantity: 10 }],
    },
  );

  return {
    warehouseId,
    storageLocationId: storage.id,
    workCenterId: workCenter!.id,
    fgProductId: fg.id,
    fgProductSku: fgSku,
    ingredientId: ing.id,
    recipeId: recipe.recipe.id,
    shortfall: 2,
  };
}

/**
 * Create a WO via the UI creation dialog on the `/ordenes-de-trabajo` list
 * page. Returns the WO's code as rendered in the list after successful
 * submission.
 */
async function createWorkOrderViaUI(
  page: Page,
  params: {
    recipeName: string;
    fgSku: string;
    warehouseName: string;
    workCenterName: string;
    fgQuantity: number;
  },
): Promise<string> {
  await page.goto('/ordenes-de-trabajo');
  await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
    timeout: 10000,
  });

  await page.getByTestId('new-work-order-btn').click({ force: true });
  await expect(page.getByTestId('submit-work-order-btn')).toBeVisible({
    timeout: 5000,
  });

  // Each SearchableSelect renders a button + a pop-over. Click by the
  // enclosing Label text → target the button inside the same `space-y-2`.
  await selectSearchable(page, 'Receta', params.recipeName);
  await selectSearchable(
    page,
    'Producto terminado',
    params.fgSku,
  );
  const qty = page.getByTestId('fg-quantity-input');
  await qty.fill(String(params.fgQuantity));
  await selectSearchable(page, 'Almacen', params.warehouseName);
  await selectSearchable(page, 'Centro de trabajo', params.workCenterName);

  await page.getByTestId('submit-work-order-btn').click({ force: true });

  // Parse the WO code directly from the success toast. The toast text is
  // the definitive record of the newly-created code — reading the list's
  // first row is flaky because stale rows from prior runs may still be
  // ordered above the new row until the list's re-fetch completes.
  const toast = page
    .getByText(/Orden WO-\d{8}-[0-9A-F]{6} creada/i)
    .first();
  await expect(toast).toBeVisible({ timeout: 10000 });
  const toastText = (await toast.textContent()) ?? '';
  const match = toastText.match(/WO-\d{8}-[0-9A-F]{6}/);
  expect(match, `toast must contain the new WO code: ${toastText}`).not.toBeNull();
  const code = match![0];

  // Ensure the row with the new code actually appears in the table before
  // returning — downstream tests assume the list is consistent.
  await expect(
    page.locator('tr').filter({ hasText: code }).first(),
  ).toBeVisible({ timeout: 10000 });
  return code;
}

/**
 * Open the searchable-select button whose Label text matches `label`, type
 * `needle` into its search input, and click the first matching option. The
 * project's SearchableSelect renders a radix popover, so we target by role
 * `option`.
 */
async function selectSearchable(
  page: Page,
  label: string,
  needle: string,
): Promise<void> {
  // The Label element is a sibling of the trigger button inside a
  // `space-y-2` wrapper. Walk up via xpath to find the trigger.
  const trigger = page
    .locator('label', { hasText: label })
    .locator('..')
    .locator('button[role="combobox"]')
    .first();
  await trigger.click({ force: true });
  // Typing narrows the options; some have no search input for small lists
  // but the project's component always renders one.
  const search = page.getByPlaceholder(/buscar/i).last();
  await search.fill(needle);
  await page
    .getByRole('option')
    .filter({ hasText: needle })
    .first()
    .click({ force: true });
}

async function findWorkOrderByCode(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<{ id: string; code: string; status: string }> {
  const res = await apiGet<{
    data: Array<{ id: string; code: string; status: string }>;
  }>(request, token, `/work-orders?per_page=50&search=${code}`);
  const match = res.data.find((w) => w.code === code);
  expect(match, `WO ${code} not found via API search`).toBeDefined();
  return match!;
}

// ──────────────────────────────────────────────────────────────────────
// 8.1–8.3 + 8.5 share a serial chain (the WO created in 8.1 is reused).
// ──────────────────────────────────────────────────────────────────────

test.describe('Work orders — happy-path chain (create → issue → complete)', () => {
  test.describe.configure({ mode: 'serial' });

  let seed: SeedIds;
  let createdCode: string;
  let token: string;

  test.beforeAll(async ({ request }) => {
    ({ token } = await apiLogin(request));
    seed = await ensureSeedForChain(request, token);
  });

  test('8.1 — creates a work order from scratch', async ({ page, request }) => {
    await login(page);

    // Resolve human-readable names for the selectors.
    const warehouses = unwrapList<{ id: string; name: string }>(
      await apiGet(request, token, '/warehouses?per_page=200'),
    );
    const warehouse = warehouses.find((w) => w.id === seed.warehouseId);
    const locs = unwrapList<{
      id: string;
      name: string;
      location_type: string;
    }>(
      await apiGet(
        request,
        token,
        `/warehouses/${seed.warehouseId}/locations`,
      ),
    );
    const workCenter = locs.find((l) => l.id === seed.workCenterId);
    const recipe = await apiGet<{ recipe: { id: string; name: string } }>(
      request,
      token,
      `/recipes/${seed.recipeId}`,
    );

    createdCode = await createWorkOrderViaUI(page, {
      recipeName: recipe.recipe.name,
      fgSku: seed.fgProductSku,
      warehouseName: warehouse!.name,
      workCenterName: workCenter!.name,
      fgQuantity: 1,
    });

    // Row's status badge is "Borrador".
    const row = page
      .locator('tr', { hasText: createdCode })
      .first();
    await expect(
      row.locator('[data-testid="work-order-status-badge"]'),
    ).toHaveText('Borrador');
  });

  test('8.2 — issues the work order', async ({ page, request }) => {
    await login(page);
    const { id: woId } = await findWorkOrderByCode(request, token, createdCode);
    await page.goto(`/ordenes-de-trabajo/${woId}`);
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('issue-wo-btn').click({ force: true });
    await page.getByTestId('confirm-delete-btn').click({ force: true });

    await expect(
      page.getByTestId('work-order-status-badge'),
    ).toHaveText('En proceso', { timeout: 10000 });

    // Consumed column stays 0 until complete — check the first material row.
    const firstMaterial = page
      .locator('[data-testid="wo-material-row"]')
      .first();
    const cells = firstMaterial.locator('td');
    await expect(cells.nth(2)).toHaveText('0');
  });

  test('8.3 — completes the work order and generates the FG lot', async ({
    page,
    request,
  }) => {
    await login(page);
    const { id: woId } = await findWorkOrderByCode(request, token, createdCode);
    await page.goto(`/ordenes-de-trabajo/${woId}`);
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('complete-wo-btn').click({ force: true });
    await expect(
      page.getByTestId('work-order-status-badge'),
    ).toHaveText('Completada', { timeout: 15000 });

    // FG lot panel renders with the expected lot-number prefix + pendiente
    // quality.
    await expect(page.getByTestId('wo-fg-lot-panel')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('fg-lot-quality-badge')).toHaveText(
      'Pendiente',
    );
    const lotLink = page.getByTestId('fg-lot-link');
    await expect(lotLink).toBeVisible();
    const lotLabel = (await lotLink.textContent()) ?? '';
    expect(lotLabel).toMatch(
      new RegExp(`WO-${createdCode}-\\d{8}`),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// 8.4 — insufficient stock → per-row error surface (SPEC §4 requirement)
// ──────────────────────────────────────────────────────────────────────

test.describe('Work orders — insufficient stock surfaces per row', () => {
  test.describe.configure({ mode: 'serial' });

  test('8.4 — renders the visible per-row error surface (not a toast)', async ({
    page,
    request,
  }) => {
    const { token } = await apiLogin(request);
    const shortSeed = await ensureShortStockScenario(request, token);

    // Build + issue the WO via API so the UI work starts at "in_progress".
    // The spec is about the 409 surface, not the full chain.
    const wo = await apiPost<{ id: string; code: string }>(
      request,
      token,
      '/work-orders',
      {
        recipe_id: shortSeed.recipeId,
        fg_product_id: shortSeed.fgProductId,
        fg_quantity: 1,
        warehouse_id: shortSeed.warehouseId,
        work_center_location_id: shortSeed.workCenterId,
        notes: 'E2E insufficient-stock scenario',
      },
    );
    await apiPost(request, token, `/work-orders/${wo.id}/issue`, {});
    // Starve the work-center — exit 2 units so the BOM expects 10 but only
    // 8 remain. The complete call will then fail with a 409 carrying the
    // shortfall body.
    await apiPost(request, token, '/movements/exit', {
      product_id: shortSeed.ingredientId,
      from_location_id: shortSeed.workCenterId,
      quantity: shortSeed.shortfall,
      notes: 'E2E — simulate loss at work-center to trigger shortfall',
    });

    await login(page);
    await page.goto(`/ordenes-de-trabajo/${wo.id}`);
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('work-order-status-badge')).toHaveText(
      'En proceso',
    );

    // Click Complete → 409 expected. The UI must render the per-row surface,
    // NOT a toast.
    await page.getByTestId('complete-wo-btn').click({ force: true });

    const surface = page.getByTestId('insufficient-stock-surface');
    await expect(surface).toBeVisible({ timeout: 10000 });
    await expect(surface).toContainText('Stock insuficiente');

    const row = surface.locator('[data-testid="missing-material-row"]').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('10'); // Esperado
    await expect(row).toContainText('8'); // Disponible
    // Shortfall is the explicit "Faltante" column. With expected=10,
    // available=8, shortfall=2. The cell matches `2` exactly — guard against
    // weak matching with a strict column locator.
    const cells = row.locator('td');
    await expect(cells.nth(3)).toHaveText(String(shortSeed.shortfall));

    // Status badge remains "En proceso" — completion must not have
    // partially landed.
    await expect(page.getByTestId('work-order-status-badge')).toHaveText(
      'En proceso',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// 8.5 — cancel in_progress reverses transfers + movement chip
// ──────────────────────────────────────────────────────────────────────

test.describe('Work orders — cancel in_progress reverses transfers', () => {
  test.describe.configure({ mode: 'serial' });

  test('8.5 — confirms cancellation and shows reversal movements', async ({
    page,
    request,
  }) => {
    const { token } = await apiLogin(request);
    const seed = await ensureSeedForChain(request, token);

    // Stand the WO up via API to isolate from 8.1's chain.
    const wo = await apiPost<{ id: string; code: string }>(
      request,
      token,
      '/work-orders',
      {
        recipe_id: seed.recipeId,
        fg_product_id: seed.fgProductId,
        fg_quantity: 1,
        warehouse_id: seed.warehouseId,
        work_center_location_id: seed.workCenterId,
        notes: 'E2E cancel scenario',
      },
    );
    await apiPost(request, token, `/work-orders/${wo.id}/issue`, {});

    await login(page);
    await page.goto(`/ordenes-de-trabajo/${wo.id}`);
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('cancel-wo-btn').click({ force: true });
    // Confirm dialog body mentions reversal count — the recipe has 1
    // material so we assert on the "revertirán" keyword which is present in
    // the dialog description regardless of count.
    const dialogDescription = page.getByText(/revertirán/i).first();
    await expect(dialogDescription).toBeVisible({ timeout: 5000 });
    await page.getByTestId('confirm-delete-btn').click({ force: true });

    await expect(page.getByTestId('work-order-status-badge')).toHaveText(
      'Cancelada',
      { timeout: 10000 },
    );

    // Navigate to the movements page with the WO filter deep-linked.
    await page.goto(`/movimientos?work_order_id=${wo.id}`);
    await expect(page.getByTestId('movements-page')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('work-order-filter-chip')).toBeVisible();
    await expect(page.getByTestId('work-order-filter-code')).toHaveText(
      wo.code,
    );

    // At least one row with the `wo_cancel_reversal` humanized label is
    // visible. The movements page labels it "Reversa por cancelacion".
    await expect(
      page.getByText(/Reversa por cancelacion/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
