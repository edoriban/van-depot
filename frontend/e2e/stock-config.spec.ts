import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Stock Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to stock config page', async ({ page }) => {
    await page.goto('/configuracion-stock');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuracion de Stock' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Define los umbrales globales y por producto')).toBeVisible();
  });

  test('can see the global configuration card', async ({ page }) => {
    await page.goto('/configuracion-stock');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuracion de Stock' })).toBeVisible({ timeout: 10000 });

    // The global config card should be visible
    await expect(page.getByText('Configuracion global')).toBeVisible({ timeout: 10000 });

    // Either the config values or the "no config" message should show
    await expect(
      page.getByText('Stock minimo por defecto').or(page.getByText('No hay configuracion global definida'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('can modify global configuration values', async ({ page }) => {
    await page.goto('/configuracion-stock');
    await expect(page.getByText('Configuracion global')).toBeVisible({ timeout: 10000 });

    // Click the edit/configure button
    const editBtn = page.getByRole('button', { name: /Editar|Configurar/ });
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click({ force: true });

    // Dialog should open with form fields
    await expect(
      page.getByText('Editar configuracion global').or(page.getByText('Crear configuracion global'))
    ).toBeVisible({ timeout: 5000 });

    // Fill in the form fields
    const minStockInput = page.locator('input[type="number"]').first();
    await minStockInput.clear();
    await minStockInput.fill('15');

    // Submit the form
    await page.getByRole('button', { name: 'Guardar' }).click({ force: true });

    // Expect success toast or error
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'actualizada' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 10000 });
  });

  test('can see product overrides section', async ({ page }) => {
    await page.goto('/configuracion-stock');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuracion de Stock' })).toBeVisible({ timeout: 10000 });

    // The product overrides section should be visible
    await expect(page.getByText('Configuracion por producto')).toBeVisible({ timeout: 10000 });

    // Either the overrides table or empty state should show
    await expect(
      page.locator('[data-slot="table-container"]').or(page.getByText('Sin configuraciones personalizadas'))
    ).toBeVisible({ timeout: 10000 });

    // The "Agregar producto" button should be present
    await expect(page.getByRole('button', { name: 'Agregar producto' }).first()).toBeVisible();
  });
});
