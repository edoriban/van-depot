import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers MOV-INV-4 — work_order_id deep-link breadcrumb chip.
// Loads /movimientos?work_order_id=<id>&tab=entry and asserts:
//   - The work-order-filter-chip renders.
//   - The chip's "X" button strips work_order_id from the URL while
//     preserving the tab param.
//
// This test uses a synthetic UUID so it passes even without a matching WO
// in the backend — the chip still renders with the truncated id fallback.
test.describe('Movements page — work_order_id deep-link', () => {
  const SYNTHETIC_WO_ID = '00000000-0000-0000-0000-000000000abc';

  test('should render the chip when work_order_id is in the URL', async ({ page }) => {
    await login(page);
    await page.goto(`/movimientos?work_order_id=${SYNTHETIC_WO_ID}&tab=entry`);

    await expect(page.getByTestId('movements-page')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('work-order-filter-chip')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('work-order-filter-code')).toBeVisible();
  });

  test('should clear the chip and preserve the tab param when dismissed', async ({ page }) => {
    await login(page);
    await page.goto(`/movimientos?work_order_id=${SYNTHETIC_WO_ID}&tab=transfer`);

    await expect(page.getByTestId('work-order-filter-chip')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('clear-work-order-filter').click({ force: true });

    // The chip should disappear.
    await expect(page.getByTestId('work-order-filter-chip')).toBeHidden({ timeout: 5000 });

    // URL should no longer carry work_order_id but the tab param survives.
    await expect(page).toHaveURL(/\/movimientos\?tab=transfer$/);
  });

  test('should scope the history fetch via work_order_id when deep-linked', async ({ page }) => {
    await login(page);

    const requestPromise = page.waitForRequest(
      (req) =>
        req.method() === 'GET' &&
        req.url().includes('/movements') &&
        req.url().includes(`work_order_id=${SYNTHETIC_WO_ID}`),
      { timeout: 10000 },
    );

    await page.goto(`/movimientos?work_order_id=${SYNTHETIC_WO_ID}`);
    const req = await requestPromise.catch(() => null);
    expect(req).not.toBeNull();
  });
});
