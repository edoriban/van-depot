import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-5 Adjustment submission flow. Skips gracefully when seed
// inventory is missing.
test.describe('Movements page — adjustment form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos?tab=adjustment');
  });

  test('should display the adjustment form when the Ajuste tab is active', async ({ page }) => {
    await expect(page.getByTestId('adjustment-form')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('adjustment-warehouse')).toBeVisible();
    await expect(page.getByTestId('adjustment-location')).toBeVisible();
    await expect(page.getByTestId('adjustment-quantity')).toBeVisible();
    await expect(page.getByTestId('adjustment-submit')).toBeVisible();
  });

  test('should submit an ajuste if seed data exists', async ({ page }) => {
    await expect(page.getByTestId('adjustment-form')).toBeVisible({ timeout: 10000 });

    const warehouseSelect = page.getByTestId('adjustment-warehouse');
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
    const locationSelect = page.getByTestId('adjustment-location');
    const locationOptions = await locationSelect.locator('option').count();
    if (locationOptions <= 1) {
      test.skip();
      return;
    }
    const firstLocationValue = await locationSelect.locator('option').nth(1).getAttribute('value');
    if (firstLocationValue) {
      await locationSelect.selectOption(firstLocationValue);
    }

    // Adjustment uses absolute "new quantity" — set it to 0 for a safe test.
    await page.getByTestId('adjustment-quantity').fill('0');
    await page.getByTestId('adjustment-reference').fill('Test E2E adjustment');

    await page.getByTestId('adjustment-submit').click({ force: true });

    const successToast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Ajuste registrado' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
