import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@vandev.mx');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('displays KPI cards', async ({ page }) => {
    await expect(page.locator('[data-testid="kpi-cards"]')).toBeVisible();
  });

  test('displays recent movements table', async ({ page }) => {
    await expect(page.locator('[data-testid="recent-movements"]')).toBeVisible();
  });

  test('displays low stock alert section', async ({ page }) => {
    await expect(page.locator('[data-testid="low-stock-alert"]')).toBeVisible();
  });

  test('shows welcome message with user name', async ({ page }) => {
    await expect(page.locator('text=Bienvenido')).toBeVisible();
  });
});
