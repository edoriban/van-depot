import { type Page } from '@playwright/test';

// Playwright steps below are intentionally serial — the page must navigate
// before the inputs render, and parallel fills against a single Page have
// proven flaky in CI. Do NOT wrap these in Promise.all.
export async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });
  await page.fill('input[name="email"]', 'edgar@vandev.mx');
  await page.fill('input[name="password"]', 'demo123');
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForURL('**/inicio', { timeout: 15000 });
}
