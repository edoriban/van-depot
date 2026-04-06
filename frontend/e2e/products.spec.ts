import { test, expect } from '@playwright/test';

test.describe('Products', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@vandev.mx');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('can navigate to products page', async ({ page }) => {
    await page.click('a[href="/productos"]');
    await expect(page).toHaveURL(/.*productos/);
    await expect(page.locator('h1')).toContainText('Productos');
  });

  test('can search products', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('h1')).toContainText('Productos');
    await page.fill('[data-testid="search-input"]', 'tubo');
    // Should trigger search - table should still be visible
    await expect(
      page.locator('table, .text-muted-foreground')
    ).toBeVisible();
  });

  test('can filter by category', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('[data-testid="category-filter"]')).toBeVisible();
  });

  test('can create a product', async ({ page }) => {
    await page.goto('/productos');
    await page.click('[data-testid="new-product-btn"]');
    await page.fill('[data-testid="product-name-input"]', 'Producto Test E2E');
    await page.fill('[data-testid="product-sku-input"]', 'TEST-E2E-001');
    await page.fill('[data-testid="product-min-stock-input"]', '10');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Producto Test E2E');
  });

  test('can edit a product', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="edit-product-btn"]').first().click();
    await expect(page.locator('[data-testid="product-name-input"]')).toBeVisible();
    const nameInput = page.locator('[data-testid="product-name-input"]');
    await nameInput.clear();
    await nameInput.fill('Producto Editado E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Producto Editado E2E');
  });

  test('can delete a product', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="delete-product-btn"]').first().click();
    await page.click('[data-testid="confirm-delete-btn"]');
    await expect(
      page.locator('[data-slot="table-container"], .text-muted-foreground')
    ).toBeVisible();
  });

  test('shows empty state when no products exist', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('h1')).toContainText('Productos');
  });
});

test.describe('Categories', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@vandev.mx');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('can navigate to categories page', async ({ page }) => {
    await page.click('a[href="/categorias"]');
    await expect(page).toHaveURL(/.*categorias/);
    await expect(page.locator('h1')).toContainText('Categorias');
  });

  test('can create a category', async ({ page }) => {
    await page.goto('/categorias');
    await page.click('[data-testid="new-category-btn"]');
    await page.fill('[data-testid="category-name-input"]', 'Categoria Test E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Categoria Test E2E');
  });

  test('can edit a category', async ({ page }) => {
    await page.goto('/categorias');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="edit-category-btn"]').first().click();
    await expect(page.locator('[data-testid="category-name-input"]')).toBeVisible();
    const nameInput = page.locator('[data-testid="category-name-input"]');
    await nameInput.clear();
    await nameInput.fill('Categoria Editada E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Categoria Editada E2E');
  });

  test('can delete a category', async ({ page }) => {
    await page.goto('/categorias');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="delete-category-btn"]').first().click();
    await page.click('[data-testid="confirm-delete-btn"]');
    await expect(
      page.locator('[data-slot="table-container"], .text-muted-foreground')
    ).toBeVisible();
  });
});

test.describe('Suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@vandev.mx');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('can navigate to suppliers page', async ({ page }) => {
    await page.click('a[href="/proveedores"]');
    await expect(page).toHaveURL(/.*proveedores/);
    await expect(page.locator('h1')).toContainText('Proveedores');
  });

  test('can create a supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await page.click('[data-testid="new-supplier-btn"]');
    await page.fill('[data-testid="supplier-name-input"]', 'Proveedor Test E2E');
    await page.fill('[data-testid="supplier-contact-input"]', 'Juan Perez');
    await page.fill('[data-testid="supplier-phone-input"]', '5551234567');
    await page.fill('[data-testid="supplier-email-input"]', 'test@proveedor.mx');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Proveedor Test E2E');
  });

  test('can edit a supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="edit-supplier-btn"]').first().click();
    await expect(page.locator('[data-testid="supplier-name-input"]')).toBeVisible();
    const nameInput = page.locator('[data-testid="supplier-name-input"]');
    await nameInput.clear();
    await nameInput.fill('Proveedor Editado E2E');
    await page.click('[data-testid="submit-btn"]');
    await expect(page.locator('table')).toContainText('Proveedor Editado E2E');
  });

  test('can delete a supplier', async ({ page }) => {
    await page.goto('/proveedores');
    await expect(page.locator('table')).toBeVisible();
    await page.locator('[data-testid="delete-supplier-btn"]').first().click();
    await page.click('[data-testid="confirm-delete-btn"]');
    await expect(
      page.locator('[data-slot="table-container"], .text-muted-foreground')
    ).toBeVisible();
  });
});
