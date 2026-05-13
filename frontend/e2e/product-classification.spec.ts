/**
 * E2E for the product-classification change (Batch 6, Phase 8).
 *
 * Coverage:
 *   8.1 — Create one product per class; assert badge + has_expiry visibility.
 *   8.2 — Chip-row class filter narrows the list.
 *   8.3 — Reclassify happy path on an unlocked product.
 *   8.4 — Reclassify is disabled (with tooltip + counts) on a locked product.
 *   8.5 — Receive flow per class (raw_material → "Lote …", tool_spare →
 *         "Inventario directo creado").
 *
 * Test isolation strategy (matches the rest of the suite): every test creates
 * its own UUID-suffixed fixtures via the UI and scopes assertions to those
 * SKUs, so the pre-existing dev-DB rows from seed don't poison results.
 */

import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

const CLASS_SHORT_LABEL = {
  raw_material: 'Materia prima',
  consumable: 'Consumible',
  tool_spare: 'Herramienta',
} as const;

type ProductClassUi = keyof typeof CLASS_SHORT_LABEL;

const CLASS_LONG_LABEL: Record<ProductClassUi, string> = {
  raw_material: 'Materia prima',
  consumable: 'Consumible',
  tool_spare: 'Herramienta / refacción',
};

interface CreateProductOptions {
  page: Page;
  name: string;
  sku: string;
  productClass: ProductClassUi;
  hasExpiry?: boolean;
  minStock?: string;
}

/**
 * Fill the SearchableSelect inside the create-product dialog. Implementation:
 * click the trigger (a `combobox` button), then click the listbox option.
 */
async function pickClass(page: Page, productClass: ProductClassUi) {
  const wrapper = page.getByTestId('product-class-select-wrapper');
  await wrapper.getByRole('combobox').click();
  await page
    .getByRole('option', { name: CLASS_LONG_LABEL[productClass], exact: true })
    .click();
}

async function createProductViaUi({
  page,
  name,
  sku,
  productClass,
  hasExpiry = false,
  minStock = '5',
}: CreateProductOptions) {
  await page.goto('/productos');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Productos' }),
  ).toBeVisible({ timeout: 30000 });

  await page.getByTestId('new-product-btn').click({ force: true });
  await expect(page.getByTestId('product-name-input')).toBeVisible();

  await page.getByTestId('product-name-input').fill(name);
  await page.getByTestId('product-sku-input').fill(sku);

  await pickClass(page, productClass);

  // For tool_spare, the toggle wrapper is replaced by the *_hidden marker.
  if (productClass !== 'tool_spare' && hasExpiry) {
    const toggle = page.getByTestId('product-has-expiry-toggle');
    await expect(toggle).toBeVisible();
    await toggle.check();
  }

  await page.getByTestId('product-min-stock-input').clear();
  await page.getByTestId('product-min-stock-input').fill(minStock);

  await page.getByTestId('submit-btn').click({ force: true });

  // Wait for the dialog to close — the table will refresh shortly after.
  await expect(page.getByTestId('product-name-input')).toBeHidden({
    timeout: 10000,
  });
}

/**
 * Open the product detail page for a product matching the given SKU.
 * Assumes the product is on the first page of `/productos`.
 */
async function openProductDetailBySku(page: Page, sku: string) {
  await page.goto('/productos');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Productos' }),
  ).toBeVisible({ timeout: 30000 });
  // Filter the list down via search to keep this resilient to pagination.
  await page.getByTestId('search-input').fill(sku);
  // The table refetches on debounce; wait until the row containing the SKU
  // becomes visible, then click its product-detail link.
  const row = page.locator('tr', { hasText: sku });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByTestId('product-detail-link').click();
  await expect(page.getByTestId('product-detail-page')).toBeVisible({
    timeout: 10000,
  });
}

// ───────────────────────────────────────────────────────────────────────
// 8.1 — Create per class + has_expiry behavior for tool_spare
// ───────────────────────────────────────────────────────────────────────

test.describe('Product classification — create per class', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    '8.1 form: tool_spare hides the has_expiry toggle',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.1a'] },
    async ({ page }) => {
      await page.goto('/productos');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Productos' }),
      ).toBeVisible({ timeout: 10000 });

      await page.getByTestId('new-product-btn').click({ force: true });
      await expect(page.getByTestId('product-name-input')).toBeVisible();

      // Default class on open is raw_material → toggle is rendered.
      await expect(page.getByTestId('product-has-expiry-toggle')).toBeVisible();

      await pickClass(page, 'tool_spare');

      // After switching to tool_spare, the toggle is replaced by the hidden
      // marker; the actual checkbox is no longer in the DOM.
      await expect(
        page.getByTestId('product-has-expiry-hidden'),
      ).toBeVisible();
      await expect(page.getByTestId('product-has-expiry-toggle')).toBeHidden();

      // Switching back to consumable re-renders the toggle.
      await pickClass(page, 'consumable');
      await expect(page.getByTestId('product-has-expiry-toggle')).toBeVisible();
    },
  );

  test(
    '8.1 creates one product of each class with the expected badge',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.1b'] },
    async ({ page }) => {
      const stamp = Date.now();

      const fixtures: ReadonlyArray<{
        cls: ProductClassUi;
        sku: string;
        name: string;
        hasExpiry: boolean;
      }> = [
        {
          cls: 'raw_material',
          sku: `PC-RM-${stamp}`,
          name: `PC raw ${stamp}`,
          hasExpiry: false,
        },
        {
          cls: 'consumable',
          sku: `PC-CN-${stamp}`,
          name: `PC consumible ${stamp}`,
          hasExpiry: true,
        },
        {
          cls: 'tool_spare',
          sku: `PC-TS-${stamp}`,
          name: `PC herramienta ${stamp}`,
          hasExpiry: false,
        },
      ];

      // Sequential creation is intentional — each iteration shares the same Page
      // and the UI under test cannot service parallel CRUD against a single tab.
      for (const f of fixtures) {
        await createProductViaUi({
          page,
          name: f.name,
          sku: f.sku,
          productClass: f.cls,
          hasExpiry: f.hasExpiry,
        });

        // Open the freshly created product's detail page and verify the
        // class badge has the expected `data-class` attribute.
        await openProductDetailBySku(page, f.sku);
        const badge = page.getByTestId('product-class-badge').first();
        await expect(badge).toBeVisible();
        await expect(badge).toHaveAttribute('data-class', f.cls);

        // tool_spare must never show the has_expiry chip; consumable with
        // expiry must show it.
        if (f.cls === 'tool_spare') {
          await expect(page.getByTestId('product-has-expiry-chip')).toBeHidden();
        } else if (f.hasExpiry) {
          await expect(
            page.getByTestId('product-has-expiry-chip'),
          ).toBeVisible();
        }
      }
    },
  );
});

// ───────────────────────────────────────────────────────────────────────
// 8.2 — Chip-row class filter
// ───────────────────────────────────────────────────────────────────────

test.describe('Product classification — chip-row filter', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    '8.2 clicking a chip filters the product table by class',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.2'] },
    async ({ page }) => {
      const stamp = Date.now();

      // Seed 3 fresh products, one per class. Use a long unique SKU prefix
      // so the search box can scope the table to *only* our fixtures.
      const skuPrefix = `PCFLT-${stamp}`;
      const skus = {
        raw_material: `${skuPrefix}-RM`,
        consumable: `${skuPrefix}-CN`,
        tool_spare: `${skuPrefix}-TS`,
      };

      await createProductViaUi({
        page,
        name: `Filter raw ${stamp}`,
        sku: skus.raw_material,
        productClass: 'raw_material',
      });
      await createProductViaUi({
        page,
        name: `Filter consumible ${stamp}`,
        sku: skus.consumable,
        productClass: 'consumable',
      });
      await createProductViaUi({
        page,
        name: `Filter herramienta ${stamp}`,
        sku: skus.tool_spare,
        productClass: 'tool_spare',
      });

      // Anchor every assertion to the prefix so pre-existing dev-DB rows
      // can't pollute the visible row set.
      await page.getByTestId('search-input').fill(skuPrefix);

      // "Todos" → all three rows visible.
      await page.getByTestId('class-chip-all').click();
      await expect(page.locator('tr', { hasText: skus.raw_material })).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator('tr', { hasText: skus.consumable }),
      ).toBeVisible();
      await expect(
        page.locator('tr', { hasText: skus.tool_spare }),
      ).toBeVisible();

      // raw_material chip → only the RM row visible, others gone.
      await page.getByTestId('class-chip-raw-material').click();
      await expect(
        page.locator('tr', { hasText: skus.raw_material }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('tr', { hasText: skus.consumable }),
      ).toBeHidden();
      await expect(
        page.locator('tr', { hasText: skus.tool_spare }),
      ).toBeHidden();

      // URL is bound to ?class= so the filter persists across reload.
      await expect(page).toHaveURL(/[?&]class=raw_material/);

      await page.getByTestId('class-chip-consumable').click();
      await expect(
        page.locator('tr', { hasText: skus.consumable }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('tr', { hasText: skus.raw_material }),
      ).toBeHidden();

      await page.getByTestId('class-chip-tool-spare').click();
      await expect(
        page.locator('tr', { hasText: skus.tool_spare }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('tr', { hasText: skus.consumable }),
      ).toBeHidden();
    },
  );
});

// ───────────────────────────────────────────────────────────────────────
// 8.3 — Reclassify happy path
// ───────────────────────────────────────────────────────────────────────

test.describe('Product classification — reclassify (unlocked)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    '8.3 reclassifies an unused product from raw_material to consumable',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.3'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PCRECL-${stamp}`;

      await createProductViaUi({
        page,
        name: `Reclasificable ${stamp}`,
        sku,
        productClass: 'raw_material',
      });

      await openProductDetailBySku(page, sku);

      const reclassifyBtn = page.getByTestId('reclassify-btn');
      await expect(reclassifyBtn).toBeVisible();
      await expect(reclassifyBtn).toHaveAttribute('data-locked', 'false');
      await reclassifyBtn.click();

      // Dialog opens with class picker.
      const dialog = page.getByTestId('reclassify-dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('combobox').click();
      await page
        .getByRole('option', { name: CLASS_LONG_LABEL.consumable, exact: true })
        .click();

      const confirm = page.getByTestId('reclassify-confirm-btn');
      await expect(confirm).toBeEnabled();
      await confirm.click();

      // After success, the badge updates to consumable.
      const badge = page.getByTestId('product-class-badge').first();
      await expect(badge).toHaveAttribute('data-class', 'consumable', {
        timeout: 10000,
      });
    },
  );
});

// ───────────────────────────────────────────────────────────────────────
// 8.4 — Reclassify locked state
// ───────────────────────────────────────────────────────────────────────

test.describe('Product classification — reclassify (locked)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    '8.4 disables Confirm and surfaces lock counts after a lot is received',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.4'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PCLOCK-${stamp}`;
      const productName = `Bloqueable ${stamp}`;
      const lotNumber = `LOT-${stamp}`;

      // 1. Create a raw_material product.
      await createProductViaUi({
        page,
        name: productName,
        sku,
        productClass: 'raw_material',
      });

      // 2. Receive a lot for it via the movements receive form. This generates
      // a movement + lot, which will lock reclassification.
      await page.goto('/movimientos');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Movimientos' }),
      ).toBeVisible({ timeout: 10000 });

      // The receive-lot form lives behind a tab in the movements page.
      // Find and click any tab/button that opens the entry-lot form, then
      // fill it. We rely on the `data-testid="entry-lot-form"` marker that
      // already exists in the implementation.
      // Make sure we're on the "Entrada" tab and switch to "Con lote".
      const entryTab = page.getByTestId('tab-entry');
      if (await entryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await entryTab.click();
      }
      const conLoteBtn = page.getByRole('button', { name: 'Con lote' }).first();
      await expect(conLoteBtn).toBeVisible({ timeout: 5000 });
      await conLoteBtn.click();

      const entryLotForm = page.getByTestId('entry-lot-form');
      await expect(entryLotForm).toBeVisible({ timeout: 5000 });

      // Pick the product we just created via the searchable select inside
      // the entry-lot form.
      const productSelect = entryLotForm.getByRole('combobox').first();
      await productSelect.click();
      await page
        .getByRole('option', { name: new RegExp(`${productName}`) })
        .first()
        .click();

      await entryLotForm.getByTestId('lot-number').fill(lotNumber);

      // The warehouse + location selectors live inside the form too. Pick
      // the first available options to keep the test environment-agnostic.
      const combos = entryLotForm.getByRole('combobox');
      // Index 1 = warehouse, Index 2 = location (combo 0 is the product).
      const warehouseSelect = combos.nth(1);
      await warehouseSelect.click();
      await page.getByRole('option').first().click();

      const locationSelect = combos.nth(2);
      await locationSelect.click();
      await page.getByRole('option').first().click();

      // good_quantity = 5
      await entryLotForm
        .locator('input[type="number"]')
        .first()
        .fill('5');

      await entryLotForm.getByTestId('lot-submit').click();

      // Wait for the success toast to appear (lot path or — if the env
      // somehow ended up with a non-raw product — direct_inventory).
      await expect(
        page.getByText(/Lote .* recibido correctamente|Inventario directo creado/),
      ).toBeVisible({ timeout: 15000 });

      // 3. Open the product detail and assert the reclassify button is locked
      // with a tooltip containing the count language.
      await openProductDetailBySku(page, sku);

      const reclassifyBtn = page.getByTestId('reclassify-btn');
      await expect(reclassifyBtn).toBeVisible({ timeout: 15000 });
      await expect(reclassifyBtn).toHaveAttribute('data-locked', 'true', {
        timeout: 15000,
      });
      await expect(reclassifyBtn).toBeDisabled();

      // Hover to surface the tooltip and assert the locked-by language.
      await page.getByTestId('reclassify-btn-wrapper').hover();
      const tooltip = page.getByTestId('reclassify-lock-tooltip');
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      await expect(tooltip).toContainText(/Bloqueado por:/);
      // At least one of "movimiento(s)" / "lote(s)" must appear.
      await expect(tooltip).toContainText(/movimiento|lote/);
    },
  );
});

// ───────────────────────────────────────────────────────────────────────
// 8.5 — Receive flow per class (lot vs direct_inventory)
// ───────────────────────────────────────────────────────────────────────

test.describe('Product classification — receive flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    '8.5 raw_material receive shows "Lote ... recibido"',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.5a'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PCRCV-RM-${stamp}`;
      const productName = `Receive raw ${stamp}`;
      const lotNumber = `LOT-RM-${stamp}`;

      await createProductViaUi({
        page,
        name: productName,
        sku,
        productClass: 'raw_material',
      });

      await page.goto('/movimientos');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Movimientos' }),
      ).toBeVisible({ timeout: 10000 });

      const entryTab = page.getByTestId('tab-entry');
      if (await entryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await entryTab.click();
      }
      const conLoteBtn = page.getByRole('button', { name: 'Con lote' }).first();
      await expect(conLoteBtn).toBeVisible({ timeout: 5000 });
      await conLoteBtn.click();

      const entryLotForm = page.getByTestId('entry-lot-form');
      await expect(entryLotForm).toBeVisible({ timeout: 5000 });

      const combos = entryLotForm.getByRole('combobox');
      await combos.nth(0).click();
      await page
        .getByRole('option', { name: new RegExp(productName) })
        .first()
        .click();

      await entryLotForm.getByTestId('lot-number').fill(lotNumber);
      await combos.nth(1).click();
      await page.getByRole('option').first().click();
      await combos.nth(2).click();
      await page.getByRole('option').first().click();

      await entryLotForm
        .locator('input[type="number"]')
        .first()
        .fill('3');

      await entryLotForm.getByTestId('lot-submit').click();

      // raw_material → lot path; toast mentions the lot number.
      await expect(
        page.getByText(`Lote ${lotNumber} recibido correctamente`),
      ).toBeVisible({ timeout: 15000 });
    },
  );

  test(
    '8.5 tool_spare receive shows "Inventario directo creado" and no lot row',
    { tag: ['@critical', '@e2e', '@product-classification', '@PC-E2E-8.5b'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PCRCV-TS-${stamp}`;
      const productName = `Receive tool ${stamp}`;
      const lotNumber = `IGNORED-${stamp}`; // backend ignores this for tool_spare

      await createProductViaUi({
        page,
        name: productName,
        sku,
        productClass: 'tool_spare',
      });

      await page.goto('/movimientos');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Movimientos' }),
      ).toBeVisible({ timeout: 10000 });

      const entryTab = page.getByTestId('tab-entry');
      if (await entryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await entryTab.click();
      }
      const conLoteBtn = page.getByRole('button', { name: 'Con lote' }).first();
      await expect(conLoteBtn).toBeVisible({ timeout: 5000 });
      await conLoteBtn.click();

      const entryLotForm = page.getByTestId('entry-lot-form');
      await expect(entryLotForm).toBeVisible({ timeout: 5000 });

      const combos = entryLotForm.getByRole('combobox');
      await combos.nth(0).click();
      await page
        .getByRole('option', { name: new RegExp(productName) })
        .first()
        .click();

      await entryLotForm.getByTestId('lot-number').fill(lotNumber);
      await combos.nth(1).click();
      await page.getByRole('option').first().click();
      await combos.nth(2).click();
      await page.getByRole('option').first().click();

      await entryLotForm
        .locator('input[type="number"]')
        .first()
        .fill('2');

      await entryLotForm.getByTestId('lot-submit').click();

      // tool_spare → direct_inventory path; toast says so and NO lot toast.
      await expect(
        page.getByText('Inventario directo creado'),
      ).toBeVisible({ timeout: 15000 });
      // Should NOT see the lot-success toast at the same time.
      await expect(
        page.getByText(`Lote ${lotNumber} recibido correctamente`),
      ).toBeHidden();

      // Visiting /lotes should NOT surface a lot row for our tool_spare SKU.
      await page.goto('/lotes');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Lotes' }),
      ).toBeVisible({ timeout: 10000 });
      // If the lots page shows our SKU, that's a regression — the receive
      // path should not have created a lot.
      await expect(page.locator('tr', { hasText: sku })).toHaveCount(0);
    },
  );
});

// Compile-time guard so a stale label table fails loudly.
test.skip('label table sanity', () => {
  for (const k of ['raw_material', 'consumable', 'tool_spare'] as ProductClassUi[]) {
    if (!CLASS_SHORT_LABEL[k]) throw new Error(k);
    if (!CLASS_LONG_LABEL[k]) throw new Error(k);
  }
});
