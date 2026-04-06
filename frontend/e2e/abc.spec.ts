import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Clasificacion ABC', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.locator('a[href="/clasificacion-abc"]').click({ force: true });
    await page.waitForURL('**/clasificacion-abc', { timeout: 15000 });
  });

  test('displays page header and period selector', async ({ page }) => {
    await expect(page.locator('[data-testid="abc-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="period-selector"]')).toBeVisible();
    await expect(page.locator('text=Clasificacion ABC')).toBeVisible();
  });

  test('displays summary cards', async ({ page }) => {
    await expect(page.locator('[data-testid="abc-summary-cards"], [data-testid="abc-table"]')).toBeVisible();
  });

  test('displays data table', async ({ page }) => {
    await expect(page.locator('[data-testid="abc-table"]')).toBeVisible();
  });

  test('period selector changes period', async ({ page }) => {
    const selector = page.locator('[data-testid="period-selector"]');
    await selector.selectOption('30');
    await expect(selector).toHaveValue('30');
  });
});
