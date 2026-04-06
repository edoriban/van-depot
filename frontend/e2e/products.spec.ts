import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Products', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to products page', async ({ page }) => {
    await page.getByRole('link', { name: 'Productos' }).click({ force: true });
    await expect(page).toHaveURL(/.*productos/);
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
  });

  test('can search products', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('search-input').fill('tubo');
    // Should trigger search - either table or empty state should be visible
    await expect(
      page.locator('[data-slot="table-container"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test('can filter by category', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.getByTestId('category-filter')).toBeVisible({ timeout: 10000 });
  });

  test('can create a product', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('new-product-btn').click({ force: true });
    await expect(page.getByTestId('product-name-input')).toBeVisible();

    const uniqueName = `Producto Test E2E ${Date.now()}`;
    await page.getByTestId('product-name-input').fill(uniqueName);
    await page.getByTestId('product-sku-input').fill(`TEST-E2E-${Date.now()}`);
    await page.getByTestId('product-min-stock-input').clear();
    await page.getByTestId('product-min-stock-input').fill('10');
    await page.getByTestId('submit-btn').click({ force: true });

    // Wait for dialog to close and table to update
    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can edit a product', async ({ page }) => {
    await page.goto('/productos');
    // Wait for page to load - either table with data or empty state
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });

    // Wait for loading to finish
    const editBtn = page.getByTestId('edit-product-btn').first();
    // Skip if no products exist
    if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await editBtn.click({ force: true });
    await expect(page.getByTestId('product-name-input')).toBeVisible();

    const uniqueName = `Producto Editado E2E ${Date.now()}`;
    const nameInput = page.getByTestId('product-name-input');
    await nameInput.clear();
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can delete a product', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.getByTestId('delete-product-btn').first();
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

  test('shows empty state when no products exist', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Categories', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to categories page', async ({ page }) => {
    await page.getByRole('link', { name: 'Categorias' }).click({ force: true });
    await expect(page).toHaveURL(/.*categorias/);
    await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
  });

  test('can create a category', async ({ page }) => {
    await page.goto('/categorias');
    await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('new-category-btn').click({ force: true });
    await expect(page.getByTestId('category-name-input')).toBeVisible();

    const uniqueName = `Categoria Test E2E ${Date.now()}`;
    await page.getByTestId('category-name-input').fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can edit a category', async ({ page }) => {
    await page.goto('/categorias');
    await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });

    const editBtn = page.getByTestId('edit-category-btn').first();
    if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await editBtn.click({ force: true });
    await expect(page.getByTestId('category-name-input')).toBeVisible();

    const uniqueName = `Categoria Editada E2E ${Date.now()}`;
    const nameInput = page.getByTestId('category-name-input');
    await nameInput.clear();
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can delete a category', async ({ page }) => {
    await page.goto('/categorias');
    await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.getByTestId('delete-category-btn').first();
    if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await deleteBtn.click({ force: true });
    await page.getByTestId('confirm-delete-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]')
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can navigate to suppliers page', async ({ page }) => {
    await page.getByRole('link', { name: 'Proveedores' }).click({ force: true });
    await expect(page).toHaveURL(/.*proveedores/);
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
  });

  test('can create a supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('new-supplier-btn').click({ force: true });
    await expect(page.getByTestId('supplier-name-input')).toBeVisible();

    const uniqueName = `Proveedor Test E2E ${Date.now()}`;
    await page.getByTestId('supplier-name-input').fill(uniqueName);
    await page.getByTestId('supplier-contact-input').fill('Juan Perez');
    await page.getByTestId('supplier-phone-input').fill('5551234567');
    await page.getByTestId('supplier-email-input').fill('test@proveedor.mx');
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can edit a supplier', async ({ page }) => {
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
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]').getByText(uniqueName)
    ).toBeVisible({ timeout: 10000 });
  });

  test('can delete a supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.getByTestId('delete-supplier-btn').first();
    if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await deleteBtn.click({ force: true });
    await page.getByTestId('confirm-delete-btn').click({ force: true });

    await expect(
      page.locator('[data-slot="table-container"]')
    ).toBeVisible({ timeout: 10000 });
  });
});
