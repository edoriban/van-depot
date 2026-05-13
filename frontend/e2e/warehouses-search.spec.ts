import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * ALM-LIST-INV-3 — Client-side search filter on the warehouses list.
 *
 * Today the `/almacenes` page renders a `warehouse-search` input that
 * filters the loaded warehouse cards by `name` OR `address`
 * (case-insensitive). The filter is NOT URL-bound. Empty matches show a
 * centered `Sin resultados` block with the query echoed.
 *
 * These tests assert the existing behavior so the frontend-migration-almacenes
 * refactor (PR-7) cannot regress search/empty-result UX without a red signal.
 *
 * Linked to spec `sdd/frontend-migration-almacenes/spec` invariant
 * ALM-LIST-INV-3 + task `frontend-migration-almacenes` B1.
 */
test.describe('Warehouses — client-side search', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('filters the warehouse grid by name substring', async ({ page }) => {
    await page.goto('/almacenes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Almacenes' }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for the grid to render. Skip the test if the tenant happens to
    // have zero seeded warehouses (no grid → no cards to filter).
    const grid = page.getByTestId('warehouse-grid');
    if (!(await grid.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const cards = page.getByTestId('warehouse-card');
    const initialCount = await cards.count();
    if (initialCount === 0) {
      test.skip();
      return;
    }

    // Read the first card's name and use a substring of it as the query.
    // The detail link inside the card uses testid `warehouse-detail-link`
    // and renders the name as its text content.
    const firstCardLink = cards
      .first()
      .getByTestId('warehouse-detail-link')
      .first();
    const firstName = (await firstCardLink.textContent())?.trim() ?? '';
    if (firstName.length < 2) {
      test.skip();
      return;
    }
    const query = firstName.slice(0, Math.min(3, firstName.length));

    await page.getByTestId('warehouse-search').fill(query);

    // At least the originating card must still be visible.
    await expect(
      page.getByTestId('warehouse-detail-link').filter({ hasText: firstName }),
    ).toBeVisible({ timeout: 5000 });

    // And the filtered set must NOT exceed the initial set.
    const filteredCount = await cards.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('shows Sin resultados when the query matches no warehouse', async ({
    page,
  }) => {
    await page.goto('/almacenes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Almacenes' }),
    ).toBeVisible({ timeout: 10000 });

    const grid = page.getByTestId('warehouse-grid');
    if (!(await grid.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const query = `__zz_no_warehouse_match_${Date.now()}__`;
    await page.getByTestId('warehouse-search').fill(query);

    await expect(page.getByText('Sin resultados')).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText(
        `No se encontraron almacenes que coincidan con "${query}"`,
      ),
    ).toBeVisible();
    // The grid must be hidden once filtered yields zero matches.
    await expect(page.getByTestId('warehouse-grid')).toHaveCount(0);
  });
});
