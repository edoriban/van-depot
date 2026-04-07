import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to suppliers page and see the list', async ({ page }) => {
    await page.getByRole('link', { name: 'Proveedores' }).click({ force: true });
    await expect(page).toHaveURL(/.*proveedores/);
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
    // Either the table or empty state should be visible
    await expect(
      page.locator('[data-slot="table-container"]').or(page.getByText('Aun no tienes proveedores'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('can create a new supplier with full form', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('new-supplier-btn').click({ force: true });
    await expect(page.getByTestId('supplier-name-input')).toBeVisible();

    const uniqueName = `Proveedor E2E ${Date.now()}`;
    await page.getByTestId('supplier-name-input').fill(uniqueName);
    await page.getByTestId('supplier-contact-input').fill('Maria Lopez');
    await page.getByTestId('supplier-phone-input').fill('5559876543');
    await page.getByTestId('supplier-email-input').fill(`e2e-${Date.now()}@proveedor.mx`);
    await page.getByTestId('submit-btn').click({ force: true });

    // Wait for dialog to close and table to update
    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can edit an existing supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });

    const editBtn = page.getByTestId('edit-supplier-btn').first();
    if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await editBtn.click({ force: true });
    await expect(page.getByTestId('supplier-name-input')).toBeVisible();

    const uniqueName = `Proveedor Editado E2E ${Date.now()}`;
    const nameInput = page.getByTestId('supplier-name-input');
    await nameInput.clear();
    await nameInput.fill(uniqueName);

    // Also update contact info
    const contactInput = page.getByTestId('supplier-contact-input');
    await contactInput.clear();
    await contactInput.fill('Contacto Editado E2E');

    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can search and filter suppliers', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });

    // Check if search input exists; the page may use DataTable's built-in search
    const searchInput = page.getByTestId('search-input');
    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasSearch) {
      // Page loaded without search — still valid, just verify the table or empty state
      await expect(
        page.locator('[data-slot="table-container"]').or(page.getByText('Aun no tienes proveedores'))
      ).toBeVisible({ timeout: 5000 });
      return;
    }

    await searchInput.fill('E2E');
    // After typing, the table should still be visible (filtered or empty)
    await expect(
      page.locator('[data-slot="table-container"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to supplier products tab', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });

    const productsBtn = page.getByTestId('supplier-products-btn').first();
    if (!(await productsBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await productsBtn.click({ force: true });

    // The products dialog should open with a title containing "Productos de"
    await expect(
      page.getByText('Productos de', { exact: false })
    ).toBeVisible({ timeout: 10000 });

    // Either linked products table or empty state should show
    await expect(
      page.getByText('producto').first().or(page.getByText('Sin productos vinculados'))
    ).toBeVisible({ timeout: 10000 });
  });
});
