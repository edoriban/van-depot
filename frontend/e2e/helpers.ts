import { type Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });
  await page.fill('input[name="email"]', 'admin@vandev.mx');
  await page.fill('input[name="password"]', 'admin123');
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForURL('**/inicio', { timeout: 15000 });
}
