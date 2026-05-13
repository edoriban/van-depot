import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * ALM-DETAIL-INV-6 + ALM-DETAIL-INV-7 — Inventory + Movements tabs.
 *
 * Each tab MUST render either at least one row of data OR the EmptyState
 * with the canonical Spanish copy.
 *
 * Linked to spec `sdd/frontend-migration-almacenes/spec` invariants
 * ALM-DETAIL-INV-6, ALM-DETAIL-INV-7 + task D3.
 */

async function openFirstWarehouseDetail(page: Page): Promise<boolean> {
  await page.goto('/almacenes');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Almacenes' }),
  ).toBeVisible({ timeout: 10000 });

  const detailLink = page.getByTestId('warehouse-detail-link').first();
  if (!(await detailLink.isVisible({ timeout: 10000 }).catch(() => false))) {
    return false;
  }
  await detailLink.click({ force: true });
  await expect(page.getByTestId('warehouse-detail-page')).toBeVisible({
    timeout: 15000,
  });
  return true;
}

test.describe('Warehouse detail — data tabs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Inventario tab shows either rows or the empty state', async ({
    page,
  }) => {
    const opened = await openFirstWarehouseDetail(page);
    if (!opened) {
      test.skip();
      return;
    }

    await page.getByTestId('tab-inventario').click({ force: true });
    await expect(page.getByTestId('tab-inventario')).toHaveAttribute(
      'data-state',
      'active',
    );

    // Wait for either the inventory rows to render or the empty state to
    // show up. We do not assert specific counts — the test must pass for
    // any seed.
    const inventoryQuantity = page.getByTestId('inventory-quantity').first();
    const emptyState = page.getByText('No hay inventario en este almacen');

    await Promise.race([
      inventoryQuantity
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => undefined),
      emptyState
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => undefined),
    ]);

    const hasRow = await inventoryQuantity.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasRow || hasEmpty).toBe(true);
  });

  test('Movimientos tab shows either rows or the empty state', async ({
    page,
  }) => {
    const opened = await openFirstWarehouseDetail(page);
    if (!opened) {
      test.skip();
      return;
    }

    await page.getByTestId('tab-movimientos').click({ force: true });
    await expect(page.getByTestId('tab-movimientos')).toHaveAttribute(
      'data-state',
      'active',
    );

    const emptyState = page.getByText('No hay movimientos en este almacen');
    // Movement type badges use one of the four MOVEMENT_LABELS — match any.
    const typeBadges = page
      .locator('table')
      .getByText(/^(Entrada|Salida|Transferencia|Ajuste)$/)
      .first();

    await Promise.race([
      typeBadges
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => undefined),
      emptyState
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => undefined),
    ]);

    const hasRow = await typeBadges.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasRow || hasEmpty).toBe(true);
  });
});
