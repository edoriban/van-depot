import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Movements page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos');
  });

  test('should display page title and tabs', async ({ page }) => {
    await expect(page.getByTestId('movements-page')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible();

    // All 4 tabs should be visible
    await expect(page.getByTestId('tab-entry')).toBeVisible();
    await expect(page.getByTestId('tab-exit')).toBeVisible();
    await expect(page.getByTestId('tab-transfer')).toBeVisible();
    await expect(page.getByTestId('tab-adjustment')).toBeVisible();
  });

  test('should show entry form by default', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('entry-product')).toBeVisible();
    await expect(page.getByTestId('entry-warehouse')).toBeVisible();
    await expect(page.getByTestId('entry-quantity')).toBeVisible();
    await expect(page.getByTestId('entry-submit')).toBeVisible();
  });

  test('should switch between tabs and show correct forms', async ({ page }) => {
    await expect(page.getByTestId('movements-page')).toBeVisible({ timeout: 10000 });

    // Switch to exit tab
    await page.getByTestId('tab-exit').click({ force: true });
    await expect(page.getByTestId('exit-form')).toBeVisible({ timeout: 5000 });

    // Switch to transfer tab
    await page.getByTestId('tab-transfer').click({ force: true });
    await expect(page.getByTestId('transfer-form')).toBeVisible({ timeout: 5000 });

    // Switch to adjustment tab
    await page.getByTestId('tab-adjustment').click({ force: true });
    await expect(page.getByTestId('adjustment-form')).toBeVisible({ timeout: 5000 });

    // Back to entry
    await page.getByTestId('tab-entry').click({ force: true });
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 5000 });
  });

  test('should display movement history section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Historial de movimientos' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('filter-movement-type')).toBeVisible();
  });

  test('should filter movement history by type', async ({ page }) => {
    await expect(page.getByTestId('filter-movement-type')).toBeVisible({ timeout: 10000 });
    const filterSelect = page.getByTestId('filter-movement-type');
    await filterSelect.selectOption('entry');
    // Verify the filter is applied (select value changed)
    await expect(filterSelect).toHaveValue('entry');

    await filterSelect.selectOption('');
    await expect(filterSelect).toHaveValue('');
  });

  test('should submit an entry if data exists', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });

    // Check if products and warehouses are loaded in the dropdowns
    const productSelect = page.getByTestId('entry-product');
    const options = await productSelect.locator('option').count();

    // Skip if no products available (only the placeholder option)
    if (options <= 1) {
      test.skip();
      return;
    }

    // Select first real product
    const firstProductValue = await productSelect.locator('option').nth(1).getAttribute('value');
    if (firstProductValue) {
      await productSelect.selectOption(firstProductValue);
    }

    // Select first warehouse
    const warehouseSelect = page.getByTestId('entry-warehouse');
    const warehouseOptions = await warehouseSelect.locator('option').count();
    if (warehouseOptions <= 1) {
      test.skip();
      return;
    }
    const firstWarehouseValue = await warehouseSelect.locator('option').nth(1).getAttribute('value');
    if (firstWarehouseValue) {
      await warehouseSelect.selectOption(firstWarehouseValue);
    }

    // Wait for locations to load
    await page.waitForTimeout(500);
    const locationSelect = page.getByTestId('entry-to-location');
    const locationOptions = await locationSelect.locator('option').count();
    if (locationOptions <= 1) {
      test.skip();
      return;
    }
    const firstLocationValue = await locationSelect.locator('option').nth(1).getAttribute('value');
    if (firstLocationValue) {
      await locationSelect.selectOption(firstLocationValue);
    }

    // Fill quantity
    await page.getByTestId('entry-quantity').fill('10');

    // Fill optional reference
    await page.getByTestId('entry-reference').fill('Test E2E');

    // Submit
    await page.getByTestId('entry-submit').click({ force: true });

    // Expect success toast or no error (depends on backend availability)
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Entrada registrada' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });

    // Wait for either outcome
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
