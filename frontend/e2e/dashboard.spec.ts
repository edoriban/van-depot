import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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
