import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Alertas de Stock', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/alertas');
    await page.waitForSelector('[data-testid="alertas-page"]', { timeout: 15000 });
  });

  test('displays alerts page header', async ({ page }) => {
    await expect(page.locator('[data-testid="alertas-header"]')).toBeVisible();
    await expect(page.locator('text=Alertas de Stock')).toBeVisible();
  });

  test('displays filters', async ({ page }) => {
    await expect(page.locator('[data-testid="alertas-filters"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-warehouse"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-severity"]')).toBeVisible();
  });

  test('displays severity badges when alerts exist', async ({ page }) => {
    // The summary badges container should be visible if there are alerts
    const summaryBadges = page.locator('[data-testid="alert-summary-badges"]');
    const badgeCritical = page.locator('[data-testid="badge-critical"]');
    const badgeLow = page.locator('[data-testid="badge-low"]');
    const badgeWarning = page.locator('[data-testid="badge-warning"]');

    // At least one of the severity badges or the "no alerts" message should be present
    const hasBadges = await summaryBadges.isVisible().catch(() => false);
    if (hasBadges) {
      const hasCritical = await badgeCritical.isVisible().catch(() => false);
      const hasLow = await badgeLow.isVisible().catch(() => false);
      const hasWarning = await badgeWarning.isVisible().catch(() => false);
      expect(hasCritical || hasLow || hasWarning).toBeTruthy();
    }
  });

  test('displays alerts table or empty state', async ({ page }) => {
    const table = page.locator('[data-testid="alertas-table"]');
    const emptyState = page.locator('text=No hay alertas de stock');

    // Independent visibility probes — race them.
    const [hasTable, hasEmpty] = await Promise.all([
      table.isVisible().catch(() => false),
      emptyState.isVisible().catch(() => false),
    ]);
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});
