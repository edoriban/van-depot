import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('can login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    // Wait for form to be rendered (authLoading may show "Cargando..." first)
    await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });
    await page.fill('input[name="email"]', 'admin@vandev.mx');
    await page.fill('input[name="password"]', 'admin123');
    await page.locator('button[type="submit"]').click({ force: true });
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
  });
});
