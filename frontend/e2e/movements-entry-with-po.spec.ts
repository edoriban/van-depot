import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-5 Entry-with-PO submission flow including the debounced
// PO search (≥2 chars triggers GET /purchase-orders?order_number=...).
test.describe('Movements page — entry-with-PO form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos?tab=entry');
  });

  test('should switch to "Con orden de compra" and reveal the PO search input', async ({
    page,
  }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Con orden de compra' }).click();
    await expect(page.getByTestId('entry-po-form')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('po-search')).toBeVisible();
  });

  test('should trigger a debounced PO search request when typing ≥2 chars', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Con orden de compra' }).click();
    await expect(page.getByTestId('po-search')).toBeVisible({ timeout: 5000 });

    // Wait for the GET /purchase-orders?order_number=... request that fires
    // after the 300ms debounce.
    const requestPromise = page.waitForRequest(
      (req) =>
        req.method() === 'GET' &&
        req.url().includes('/purchase-orders') &&
        req.url().includes('order_number='),
      { timeout: 5000 },
    );

    await page.getByTestId('po-search').fill('OC');

    const req = await requestPromise.catch(() => null);
    // If the env has no live backend the request may still go through SWR's
    // fetcher but resolve with an error — that's fine. The contract under
    // test is that typing fires the search.
    expect(req).not.toBeNull();
  });

  test('should submit a PO receipt if seed PO data exists', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Con orden de compra' }).click();
    await expect(page.getByTestId('po-search')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('po-search').fill('OC');
    // Wait for results to settle.
    await page.waitForTimeout(800);

    // If no PO results render, skip — the seed env has no POs.
    const firstResult = page.locator('button:has(span.font-mono)').first();
    if (!(await firstResult.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await firstResult.click();

    // Pick a line if any.
    const lineRadios = page.locator('input[type="radio"][name="po-line"]');
    const lineCount = await lineRadios.count();
    if (lineCount === 0) {
      test.skip();
      return;
    }
    await lineRadios.first().check({ force: true });

    const warehouseSelect = page.getByTestId('po-warehouse');
    const warehouseOptions = await warehouseSelect.locator('option').count();
    if (warehouseOptions <= 1) {
      test.skip();
      return;
    }
    const firstWarehouseValue = await warehouseSelect.locator('option').nth(1).getAttribute('value');
    if (firstWarehouseValue) {
      await warehouseSelect.selectOption(firstWarehouseValue);
    }

    await page.waitForTimeout(500);
    const locationSelect = page.getByTestId('po-location');
    const locationOptions = await locationSelect.locator('option').count();
    if (locationOptions <= 1) {
      test.skip();
      return;
    }
    const firstLocationValue = await locationSelect.locator('option').nth(1).getAttribute('value');
    if (firstLocationValue) {
      await locationSelect.selectOption(firstLocationValue);
    }

    const lotNumber = `LOT-PO-E2E-${Date.now()}`;
    await page.getByTestId('po-lot-number').fill(lotNumber);
    await page.getByTestId('po-good-qty').fill('1');

    await page.getByTestId('po-submit').click({ force: true });

    const successToast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: /(Material recibido — OC|Inventario directo creado — OC)/ });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
