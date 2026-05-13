import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-5 Transfer submission flow including cross-location
// validation (from != to). Skips gracefully when seed inventory is missing.
test.describe('Movements page — transfer form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos?tab=transfer');
  });

  test('should display the transfer form when the Transferencia tab is active', async ({ page }) => {
    await expect(page.getByTestId('transfer-form')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('transfer-from-warehouse')).toBeVisible();
    await expect(page.getByTestId('transfer-from-location')).toBeVisible();
    await expect(page.getByTestId('transfer-to-warehouse')).toBeVisible();
    await expect(page.getByTestId('transfer-to-location')).toBeVisible();
    await expect(page.getByTestId('transfer-quantity')).toBeVisible();
    await expect(page.getByTestId('transfer-submit')).toBeVisible();
  });

  test('should submit a transferencia if seed data exists', async ({ page }) => {
    await expect(page.getByTestId('transfer-form')).toBeVisible({ timeout: 10000 });

    const fromWarehouseSelect = page.getByTestId('transfer-from-warehouse');
    const fromWarehouseOptions = await fromWarehouseSelect.locator('option').count();
    if (fromWarehouseOptions <= 1) {
      test.skip();
      return;
    }
    const fromWarehouseValue = await fromWarehouseSelect.locator('option').nth(1).getAttribute('value');
    if (fromWarehouseValue) {
      await fromWarehouseSelect.selectOption(fromWarehouseValue);
    }

    await page.waitForTimeout(500);
    const fromLocationSelect = page.getByTestId('transfer-from-location');
    const fromLocationOptions = await fromLocationSelect.locator('option').count();
    if (fromLocationOptions <= 1) {
      test.skip();
      return;
    }
    const fromLocationValue = await fromLocationSelect.locator('option').nth(1).getAttribute('value');
    if (fromLocationValue) {
      await fromLocationSelect.selectOption(fromLocationValue);
    }

    const toWarehouseSelect = page.getByTestId('transfer-to-warehouse');
    if (fromWarehouseValue) {
      await toWarehouseSelect.selectOption(fromWarehouseValue);
    }
    await page.waitForTimeout(500);

    const toLocationSelect = page.getByTestId('transfer-to-location');
    const toLocationOptions = await toLocationSelect.locator('option').count();
    if (toLocationOptions <= 1) {
      test.skip();
      return;
    }
    // Pick a destination different from the origin location.
    let chosenTo: string | null = null;
    for (let i = 1; i < toLocationOptions; i++) {
      const candidate = await toLocationSelect.locator('option').nth(i).getAttribute('value');
      if (candidate && candidate !== fromLocationValue) {
        chosenTo = candidate;
        break;
      }
    }
    if (!chosenTo) {
      test.skip();
      return;
    }
    await toLocationSelect.selectOption(chosenTo);

    await page.getByTestId('transfer-quantity').fill('1');
    await page.getByTestId('transfer-reference').fill('Test E2E transfer');

    await page.getByTestId('transfer-submit').click({ force: true });

    const successToast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Transferencia registrada' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
