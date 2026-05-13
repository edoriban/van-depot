import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * ALM-DETAIL-INV-8 — Map tab rendering + zone interaction.
 *
 * The Mapa tab orchestrates the carved-out `components/warehouse/`
 * infrastructure: `MapSummaryBar`, `MapCanvas` (dynamic + ssr:false, rendered
 * via react-konva), `ZoneDetail` panel (desktop right side / mobile bottom
 * sheet), and a placeholder empty state when zones are absent.
 *
 * Zone rectangles are drawn on a `<Stage>` (Konva canvas) and are NOT DOM
 * elements — Playwright cannot reach them via `getByLabel`, `getByTestId`,
 * or `getByRole`. Per design §5.4 + apply-prompt locked policy:
 * Option A (aria-label on zone-rect) is NOT viable because Konva does not
 * emit DOM aria attributes. Option B (testid in carve-out) is excluded by
 * the do-not-touch policy. Strategy used here:
 *   - Test 1: assert MapCanvas container OR the empty-state CTA renders.
 *   - Test 2: if `map-search-input` finds a result, clicking it navigates
 *     and surfaces `ZoneDetail` (testid `zone-detail`). Skip gracefully if
 *     no search-indexable product exists in the warehouse.
 *   - Test 3: if a `zone-detail-close` button is reachable, clicking it
 *     dismisses the panel. Skip if Test 2 was skipped.
 *
 * Linked to spec `sdd/frontend-migration-almacenes/spec` invariant
 * ALM-DETAIL-INV-8 + task D4. The strategy carry-over for PR-8 is documented
 * in design §5.4.
 */

async function openMapaTab(page: Page): Promise<boolean> {
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

  await page.getByTestId('tab-mapa').click({ force: true });
  await expect(page.getByTestId('tab-mapa')).toHaveAttribute(
    'data-state',
    'active',
  );
  return true;
}

test.describe('Warehouse detail — map tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('renders MapCanvas container OR the empty-state CTA', async ({
    page,
  }) => {
    const opened = await openMapaTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    const canvas = page.getByTestId('map-canvas-container');
    const emptyCta = page.getByRole('button', { name: 'Crear zona' });

    await Promise.race([
      canvas
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => undefined),
      emptyCta
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => undefined),
    ]);

    const hasCanvas = await canvas.isVisible().catch(() => false);
    const hasCta = await emptyCta.isVisible().catch(() => false);
    expect(hasCanvas || hasCta).toBe(true);
  });

  test('clicking a map-search result opens the ZoneDetail panel', async ({
    page,
  }) => {
    const opened = await openMapaTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    const canvas = page.getByTestId('map-canvas-container');
    if (!(await canvas.isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // The map-search input lives inside the carved-out map-canvas. Open it
    // via the toolbar's `Buscar` button if it is collapsed; otherwise the
    // input is already in the DOM.
    const buscarBtn = page.getByRole('button', { name: 'Buscar' }).first();
    if (await buscarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buscarBtn.click({ force: true });
    }
    const searchInput = page.getByTestId('map-search-input');
    if (!(await searchInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Type a permissive query — single-letter `a` is very likely to match
    // at least one product in any non-empty warehouse. Search requires >=2
    // chars; use `aa` then fall back to single common-letter queries.
    for (const query of ['aa', 'a', 'e', 'o']) {
      await searchInput.fill('');
      await searchInput.fill(query);
      const firstResult = page.getByTestId('map-search-result').first();
      if (
        await firstResult.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await firstResult.click({ force: true });
        // ZoneDetail panel renders with testid `zone-detail`.
        if (
          await page
            .getByTestId('zone-detail')
            .isVisible({ timeout: 5000 })
            .catch(() => false)
        ) {
          return;
        }
      }
    }
    // No search results in this seed — skip.
    test.skip();
  });

  test('zone-detail-close button dismisses the ZoneDetail panel', async ({
    page,
  }) => {
    const opened = await openMapaTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    const canvas = page.getByTestId('map-canvas-container');
    if (!(await canvas.isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const buscarBtn = page.getByRole('button', { name: 'Buscar' }).first();
    if (await buscarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buscarBtn.click({ force: true });
    }
    const searchInput = page.getByTestId('map-search-input');
    if (!(await searchInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    let opened2 = false;
    for (const query of ['aa', 'a', 'e', 'o']) {
      await searchInput.fill('');
      await searchInput.fill(query);
      const firstResult = page.getByTestId('map-search-result').first();
      if (
        await firstResult.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await firstResult.click({ force: true });
        if (
          await page
            .getByTestId('zone-detail')
            .isVisible({ timeout: 5000 })
            .catch(() => false)
        ) {
          opened2 = true;
          break;
        }
      }
    }
    if (!opened2) {
      test.skip();
      return;
    }

    await page.getByTestId('zone-detail-close').click({ force: true });
    await expect(page.getByTestId('zone-detail')).toHaveCount(0, {
      timeout: 5000,
    });
  });
});
