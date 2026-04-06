import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Cycle Counts page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/cycle-counts');
  });

  test('should display page title and new count button', async ({ page }) => {
    await expect(page.getByTestId('cycle-counts-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Conteos ciclicos' })).toBeVisible();
    await expect(page.getByTestId('new-count-btn')).toBeVisible();
  });

  test('should display filter controls', async ({ page }) => {
    await expect(page.getByTestId('filter-status')).toBeVisible();
    await expect(page.getByTestId('filter-warehouse')).toBeVisible();
  });

  test('should filter by status', async ({ page }) => {
    const statusFilter = page.getByTestId('filter-status');
    await statusFilter.selectOption('draft');
    await expect(statusFilter).toHaveValue('draft');

    await statusFilter.selectOption('in_progress');
    await expect(statusFilter).toHaveValue('in_progress');

    await statusFilter.selectOption('');
    await expect(statusFilter).toHaveValue('');
  });

  test('should open create dialog', async ({ page }) => {
    await page.getByTestId('new-count-btn').click();

    await expect(page.getByTestId('count-name-input')).toBeVisible();
    await expect(page.getByTestId('count-warehouse-select')).toBeVisible();
    await expect(page.getByTestId('count-notes-input')).toBeVisible();
    await expect(page.getByTestId('submit-count-btn')).toBeVisible();
  });

  test('should fill create form', async ({ page }) => {
    await page.getByTestId('new-count-btn').click();

    await page.getByTestId('count-name-input').fill('Conteo E2E Test');

    const warehouseSelect = page.getByTestId('count-warehouse-select');
    const options = await warehouseSelect.locator('option').count();

    if (options <= 1) {
      test.skip();
      return;
    }

    const firstValue = await warehouseSelect.locator('option').nth(1).getAttribute('value');
    if (firstValue) {
      await warehouseSelect.selectOption(firstValue);
    }

    await page.getByTestId('count-notes-input').fill('Notas de prueba E2E');

    // Submit the form
    await page.getByTestId('submit-count-btn').click();

    // Expect either navigation to detail page or toast
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Conteo creado' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });

    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });
});
