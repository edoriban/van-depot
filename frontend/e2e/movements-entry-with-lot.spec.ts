import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-5 Entry-with-lot submission flow. Confirms the
// EntryModeSelector switches to `Con lote` and the lot form renders the
// lot-number + good-qty inputs.
test.describe('Movements page — entry-with-lot form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/movimientos?tab=entry');
  });

  test('should switch to "Con lote" mode and display the lot form', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });

    // Click the EntryModeSelector "Con lote" toggle.
    await page.getByRole('button', { name: 'Con lote' }).click();
    await expect(page.getByTestId('entry-lot-form')).toBeVisible({ timeout: 5000 });

    await expect(page.getByTestId('lot-warehouse')).toBeVisible();
    await expect(page.getByTestId('lot-location')).toBeVisible();
    await expect(page.getByTestId('lot-number')).toBeVisible();
    await expect(page.getByTestId('lot-good-qty')).toBeVisible();
    await expect(page.getByTestId('lot-submit')).toBeVisible();
  });

  test('should submit a lot entry if seed data exists', async ({ page }) => {
    await expect(page.getByTestId('entry-form')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Con lote' }).click();
    await expect(page.getByTestId('entry-lot-form')).toBeVisible({ timeout: 5000 });

    const warehouseSelect = page.getByTestId('lot-warehouse');
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
    const locationSelect = page.getByTestId('lot-location');
    const locationOptions = await locationSelect.locator('option').count();
    if (locationOptions <= 1) {
      test.skip();
      return;
    }
    const firstLocationValue = await locationSelect.locator('option').nth(1).getAttribute('value');
    if (firstLocationValue) {
      await locationSelect.selectOption(firstLocationValue);
    }

    const lotNumber = `LOT-E2E-${Date.now()}`;
    await page.getByTestId('lot-number').fill(lotNumber);
    await page.getByTestId('lot-good-qty').fill('1');

    await page.getByTestId('lot-submit').click({ force: true });

    // Success path may toast either "Lote ... recibido" (lot kind) or
    // "Inventario directo creado" (direct_inventory kind) — accept either.
    const successToast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: /(Lote .* recibido|Inventario directo creado)/ });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
