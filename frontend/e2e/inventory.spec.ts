import { test, expect } from '@playwright/test';

test.describe('Inventory page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/inventory');
  });

  test('should display page title and filters', async ({ page }) => {
    await expect(page.getByTestId('inventory-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();

    // Filter controls should be visible
    await expect(page.getByTestId('filter-warehouse')).toBeVisible();
    await expect(page.getByTestId('filter-location')).toBeVisible();
    await expect(page.getByTestId('search-product')).toBeVisible();
    await expect(page.getByTestId('low-stock-toggle')).toBeVisible();
  });

  test('should have location filter disabled when no warehouse selected', async ({ page }) => {
    await expect(page.getByTestId('filter-location')).toBeDisabled();
  });

  test('should enable location filter when warehouse is selected', async ({ page }) => {
    const warehouseSelect = page.getByTestId('filter-warehouse');
    const options = await warehouseSelect.locator('option').count();

    if (options <= 1) {
      test.skip();
      return;
    }

    const firstValue = await warehouseSelect.locator('option').nth(1).getAttribute('value');
    if (firstValue) {
      await warehouseSelect.selectOption(firstValue);
    }

    await expect(page.getByTestId('filter-location')).toBeEnabled();
  });

  test('should toggle low stock filter', async ({ page }) => {
    const toggle = page.getByTestId('low-stock-toggle');
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
  });

  test('should allow searching products', async ({ page }) => {
    const searchInput = page.getByTestId('search-product');
    await searchInput.fill('test-product');
    await expect(searchInput).toHaveValue('test-product');
  });
});
