import { test, expect } from '@playwright/test';
import { login } from './helpers';

// PROD-LIST-INV-2 — Tab URL persistence on the /productos page.
//
// Covers the deep-link contract that today's UI honors but no e2e spec
// asserts: navigating to /productos?tab=categorias must select the
// Categorias tab on mount, and clicking back to Productos must update the
// URL via router.replace. STRICT behavior equivalence — these tests must
// pass on the PRE-refactor main branch and continue to pass after PR-5.
test.describe('Products tab deep-link', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('deep link to ?tab=categorias activates Categorias tab on mount', async ({
    page,
  }) => {
    await page.goto('/productos?tab=categorias');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Productos' }),
    ).toBeVisible({ timeout: 10000 });

    const categoriasTab = page.getByTestId('tab-categorias');
    const productosTab = page.getByTestId('tab-productos');

    await expect(categoriasTab).toHaveAttribute('data-state', 'active', {
      timeout: 10000,
    });
    await expect(productosTab).toHaveAttribute('data-state', 'inactive');
  });

  test('clicking Productos tab from ?tab=categorias flips URL to ?tab=productos', async ({
    page,
  }) => {
    await page.goto('/productos?tab=categorias');
    await expect(page.getByTestId('tab-categorias')).toHaveAttribute(
      'data-state',
      'active',
      { timeout: 10000 },
    );

    await page.getByTestId('tab-productos').click({ force: true });

    await expect(page).toHaveURL(/[?&]tab=productos(&|$)/, { timeout: 10000 });
    await expect(page.getByTestId('tab-productos')).toHaveAttribute(
      'data-state',
      'active',
    );
  });
});
