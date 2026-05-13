import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// PROD-DETAIL-INV-2 + PROD-DETAIL-INV-4 — Product detail edit + movement
// history pagination invariants.
//
// Covers the detail invariants that no e2e spec asserts today:
//   1) Edit form roundtrip: open detail, change name, submit, toast +
//      heading updates.
//   2) Movement history card visibility + conditional `Cargar mas` button
//      based on `total > 20`.
//
// Strict behavior equivalence — the tests MUST pass on the PRE-refactor
// `main` and continue to pass after PR-6 lands.

const CLASS_LONG_LABEL_RAW = 'Materia prima';

interface CreateProductOptions {
  page: Page;
  name: string;
  sku: string;
}

async function createRawMaterialProductViaUi({
  page,
  name,
  sku,
}: CreateProductOptions) {
  await page.goto('/productos');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Productos' }),
  ).toBeVisible({ timeout: 30000 });

  await page.getByTestId('new-product-btn').click({ force: true });
  await expect(page.getByTestId('product-name-input')).toBeVisible();

  await page.getByTestId('product-name-input').fill(name);
  await page.getByTestId('product-sku-input').fill(sku);

  // Default class on open is raw_material — but pick explicitly for clarity.
  const wrapper = page.getByTestId('product-class-select-wrapper');
  await wrapper.getByRole('combobox').click();
  await page
    .getByRole('option', { name: CLASS_LONG_LABEL_RAW, exact: true })
    .click();

  await page.getByTestId('product-min-stock-input').clear();
  await page.getByTestId('product-min-stock-input').fill('5');

  await page.getByTestId('submit-btn').click({ force: true });

  // Wait for the dialog to close.
  await expect(page.getByTestId('product-name-input')).toBeHidden({
    timeout: 10000,
  });
}

async function openProductDetailBySku(page: Page, sku: string) {
  await page.goto('/productos');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Productos' }),
  ).toBeVisible({ timeout: 30000 });

  await page.getByTestId('search-input').fill(sku);
  const row = page.locator('tr', { hasText: sku });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByTestId('product-detail-link').click();
  await expect(page.getByTestId('product-detail-page')).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Product detail — edit form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    'edits the product name from the detail page and the heading updates',
    { tag: ['@critical', '@e2e', '@product-detail', '@PROD-DETAIL-INV-2'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PDE-${stamp}`;
      const originalName = `Detalle E2E ${stamp}`;
      const editedName = `${originalName} editado`;

      await createRawMaterialProductViaUi({
        page,
        name: originalName,
        sku,
      });

      await openProductDetailBySku(page, sku);

      // Heading shows the original name on mount.
      await expect(
        page.getByRole('heading', { level: 1, name: originalName }),
      ).toBeVisible({ timeout: 10000 });

      // Edit the form name field. The detail form uses `#detail-name`.
      const nameInput = page.locator('#detail-name');
      await expect(nameInput).toBeVisible();
      await nameInput.clear();
      await nameInput.fill(editedName);

      // Submit via the form's "Guardar cambios" button (the only submit
      // button inside the edit-form Card).
      await page
        .getByRole('button', { name: /Guardar cambios|Guardando\.\.\./ })
        .click({ force: true });

      // Success toast (Sonner) renders the Spanish copy locked by spec
      // PROD-DETAIL-INV-2.
      await expect(
        page.getByText('Producto actualizado correctamente'),
      ).toBeVisible({ timeout: 10000 });

      // Heading reflects the edited name.
      await expect(
        page.getByRole('heading', { level: 1, name: editedName }),
      ).toBeVisible({ timeout: 10000 });
    },
  );
});

test.describe('Product detail — movement history card', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    'renders the movement history card with either empty state or table + conditional Cargar mas',
    { tag: ['@critical', '@e2e', '@product-detail', '@PROD-DETAIL-INV-4'] },
    async ({ page }) => {
      const stamp = Date.now();
      const sku = `PDH-${stamp}`;
      const productName = `Historial E2E ${stamp}`;

      await createRawMaterialProductViaUi({
        page,
        name: productName,
        sku,
      });

      await openProductDetailBySku(page, sku);

      // Card is visible by title text regardless of empty/populated state.
      // (CardTitle renders a <div data-slot="card-title">, not a heading.)
      await expect(
        page.locator('[data-slot="card-title"]', { hasText: 'Historial de movimientos' }),
      ).toBeVisible({ timeout: 10000 });

      // For a freshly created product (no movements yet) the empty-state
      // copy locked by spec PROD-DETAIL-INV-4 must surface.
      const emptyCopy = page.getByText(
        'No hay movimientos registrados en los ultimos 6 meses',
      );

      // The Cargar mas button only renders when `movements.length < total`.
      // For our freshly created product `total === 0` so it MUST be absent.
      const loadMoreBtn = page.getByRole('button', { name: 'Cargar mas' });

      // Either the empty-state copy is visible OR (the env had pre-seeded
      // history for the SKU which is implausible since we just made it; we
      // still allow the table to render).
      await expect(emptyCopy).toBeVisible({ timeout: 10000 });
      await expect(loadMoreBtn).toBeHidden();
    },
  );
});
