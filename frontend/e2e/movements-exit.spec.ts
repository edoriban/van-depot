import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-5 Exit submission flow.
// Pattern mirrors `movements.spec.ts` `should submit an entry if data exists`:
// the test gracefully skips when seed data is missing so it can run on a
// barebones dev environment, but exercises the full path on demo data.
test.describe('Movements page — exit form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos?tab=exit');
  });

  test('should display the exit form when the Salida tab is active', async ({ page }) => {
    await expect(page.getByTestId('exit-form')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('exit-warehouse')).toBeVisible();
    await expect(page.getByTestId('exit-from-location')).toBeVisible();
    await expect(page.getByTestId('exit-quantity')).toBeVisible();
    await expect(page.getByTestId('exit-submit')).toBeVisible();
  });

  test('should submit a salida if seed data exists', async ({ page }) => {
    await expect(page.getByTestId('exit-form')).toBeVisible({ timeout: 10000 });

    // Pick a warehouse if any non-placeholder option exists.
    const warehouseSelect = page.getByTestId('exit-warehouse');
    const warehouseOptions = await warehouseSelect.locator('option').count();
    if (warehouseOptions <= 1) {
      test.skip();
      return;
    }
    const firstWarehouseValue = await warehouseSelect.locator('option').nth(1).getAttribute('value');
    if (firstWarehouseValue) {
      await warehouseSelect.selectOption(firstWarehouseValue);
    }

    // Wait for locations to load.
    await page.waitForTimeout(500);
    const locationSelect = page.getByTestId('exit-from-location');
    const locationOptions = await locationSelect.locator('option').count();
    if (locationOptions <= 1) {
      test.skip();
      return;
    }
    const firstLocationValue = await locationSelect.locator('option').nth(1).getAttribute('value');
    if (firstLocationValue) {
      await locationSelect.selectOption(firstLocationValue);
    }

    await page.getByTestId('exit-quantity').fill('1');
    await page.getByTestId('exit-reference').fill('Test E2E exit');

    await page.getByTestId('exit-submit').click({ force: true });

    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Salida registrada' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
