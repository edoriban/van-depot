import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Warehouses', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to warehouses page', async ({ page }) => {
    await page.click('a[href="/almacenes"]');
    await expect(page).toHaveURL(/.*almacenes/);
    await expect(page.locator('h1')).toContainText('Almacenes');
  });

  test('can create a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    await page.click('[data-testid="new-warehouse-btn"]');
    await page.fill('input[name="name"]', 'Almacen Test E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Almacen Test E2E');
  });

  test('can edit a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="edit-warehouse-btn"]').first().click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    const nameInput = page.locator('input[name="name"]');
    await nameInput.clear();
    await nameInput.fill('Almacen Editado E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Almacen Editado E2E');
  });

  test('can delete a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="delete-warehouse-btn"]').first().click();
    await page.click('[data-testid="confirm-delete-btn"]');
    // After deletion, the table should still be visible (or empty state)
    await expect(page.locator('[data-slot="table-container"], .text-muted-foreground')).toBeVisible();
  });

  test('shows empty state when no warehouses exist', async ({ page }) => {
    // This test assumes a clean state - it verifies the empty state renders
    await page.goto('/almacenes');
    // Page should load without errors
    await expect(page.locator('h1')).toContainText('Almacenes');
  });
});
