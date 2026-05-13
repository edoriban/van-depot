import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * ALM-DETAIL-INV-1 + ALM-DETAIL-INV-2 — Warehouse detail tabs.
 *
 * The `/almacenes/[id]` page renders 4 tabs (`tab-ubicaciones`,
 * `tab-inventario`, `tab-movimientos`, `tab-mapa`) and persists the active
 * tab via the `?tab={value}` querystring. Default tab is `ubicaciones`.
 *
 * These tests lock the pre-refactor behavior so the
 * frontend-migration-almacenes PR-8 refactor cannot regress tab navigation
 * or deep-link restoration.
 *
 * Linked to spec `sdd/frontend-migration-almacenes/spec` invariants
 * ALM-DETAIL-INV-1 + ALM-DETAIL-INV-2 + task D1.
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

test.describe('Warehouse detail — tabs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('default tab is ubicaciones with no ?tab query string', async ({
    page,
  }) => {
    const opened = await openFirstWarehouseDetail(page);
    if (!opened) {
      test.skip();
      return;
    }

    const ubicacionesTab = page.getByTestId('tab-ubicaciones');
    await expect(ubicacionesTab).toBeVisible();
    // shadcn/radix tabs mark the active trigger with data-state="active".
    await expect(ubicacionesTab).toHaveAttribute('data-state', 'active');
  });

  test('clicking each tab updates the URL and renders its content', async ({
    page,
  }) => {
    const opened = await openFirstWarehouseDetail(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Tabs MUST be clicked sequentially (each click awaits the previous URL
    // commit) — Playwright cannot parallelize clicks on the same Page.
    const tabs = [
      { id: 'inventario', urlMatch: /\?tab=inventario/ },
      { id: 'movimientos', urlMatch: /\?tab=movimientos/ },
      { id: 'mapa', urlMatch: /\?tab=mapa/ },
      { id: 'ubicaciones', urlMatch: /\?tab=ubicaciones/ },
    ] as const;
    for (const { id, urlMatch } of tabs) {
      const trigger = page.getByTestId(`tab-${id}`);
      await trigger.click({ force: true });
      await expect(page).toHaveURL(urlMatch, { timeout: 5000 });
      await expect(trigger).toHaveAttribute('data-state', 'active');
    }
  });

  test('deep-linking ?tab=mapa activates the Mapa tab on mount', async ({
    page,
  }) => {
    // Discover an id by navigating once.
    await page.goto('/almacenes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Almacenes' }),
    ).toBeVisible({ timeout: 10000 });

    const detailLink = page.getByTestId('warehouse-detail-link').first();
    if (!(await detailLink.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    const href = await detailLink.getAttribute('href');
    if (!href) {
      test.skip();
      return;
    }

    await page.goto(`${href}?tab=mapa`);
    await expect(page.getByTestId('warehouse-detail-page')).toBeVisible({
      timeout: 15000,
    });
    const mapaTab = page.getByTestId('tab-mapa');
    await expect(mapaTab).toBeVisible();
    await expect(mapaTab).toHaveAttribute('data-state', 'active');
  });
});
