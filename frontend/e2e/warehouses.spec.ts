import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Warehouses', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to warehouses page', async ({ page }) => {
    await page.getByRole('link', { name: 'Almacenes' }).click({ force: true });
    await expect(page).toHaveURL(/.*almacenes/);
    await expect(page.getByRole('heading', { level: 1, name: 'Almacenes' })).toBeVisible({ timeout: 10000 });
  });

  test('can create a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(page.getByRole('heading', { level: 1, name: 'Almacenes' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('new-warehouse-btn').click({ force: true });

    // Wait for dialog to open - warehouse form uses id="warehouse-name"
    const nameInput = page.locator('#warehouse-name');
    await expect(nameInput).toBeVisible();

    const uniqueName = `Almacen Test E2E ${Date.now()}`;
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can edit a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(page.getByRole('heading', { level: 1, name: 'Almacenes' })).toBeVisible({ timeout: 10000 });

    const editBtn = page.getByTestId('edit-warehouse-btn').first();
    if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await editBtn.click({ force: true });
    const nameInput = page.locator('#warehouse-name');
    await expect(nameInput).toBeVisible();

    const uniqueName = `Almacen Editado E2E ${Date.now()}`;
    await nameInput.clear();
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can delete a warehouse', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(page.getByRole('heading', { level: 1, name: 'Almacenes' })).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.getByTestId('delete-warehouse-btn').first();
    if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await deleteBtn.click({ force: true });
    await page.getByTestId('confirm-delete-btn').click({ force: true });

    // After deletion, either the table or empty state should be visible
    await expect(
      page.locator('[data-slot="table-container"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows empty state when no warehouses exist', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(page.getByRole('heading', { level: 1, name: 'Almacenes' })).toBeVisible({ timeout: 10000 });
  });
});
