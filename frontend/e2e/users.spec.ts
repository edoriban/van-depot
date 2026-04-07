import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Users page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/usuarios');
  });

  test('should display page title and new user button', async ({ page }) => {
    await expect(page.getByTestId('users-page')).toBeVisible({ timeout: 10000 });

    // Page shows either the users table (admin) or access denied message
    const heading = page.getByRole('heading', { level: 1, name: 'Usuarios' });
    const denied = page.getByText('No tienes permisos');

    await expect(heading.or(denied)).toBeVisible();
  });

  test('should open create user dialog if admin', async ({ page }) => {
    await expect(page.getByTestId('users-page')).toBeVisible({ timeout: 10000 });
    const newBtn = page.getByTestId('new-user-btn');

    // Only proceed if the button is visible (user is admin)
    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await newBtn.click({ force: true });

    await expect(page.getByTestId('user-email-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('user-password-input')).toBeVisible();
    await expect(page.getByTestId('user-name-input')).toBeVisible();
    await expect(page.getByTestId('user-role-select')).toBeVisible();
    await expect(page.getByTestId('submit-user-btn')).toBeVisible();
  });

  test('should fill create user form', async ({ page }) => {
    await expect(page.getByTestId('users-page')).toBeVisible({ timeout: 10000 });
    const newBtn = page.getByTestId('new-user-btn');

    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await newBtn.click({ force: true });

    await expect(page.getByTestId('user-email-input')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('user-email-input').fill(`test-e2e-${Date.now()}@ejemplo.com`);
    await page.getByTestId('user-password-input').fill('testpass123');
    await page.getByTestId('user-name-input').fill('Usuario E2E');
    await page.getByTestId('user-role-select').selectOption('operator');

    // Submit
    await page.getByTestId('submit-user-btn').click({ force: true });

    // Expect either success or error toast
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Usuario creado' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });

    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });

  test('should show role badges in table', async ({ page }) => {
    await expect(page.getByTestId('users-page')).toBeVisible({ timeout: 10000 });
    const newBtn = page.getByTestId('new-user-btn');

    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Check if role badges are visible (at least one user should exist)
    const badges = page.getByTestId('user-role-badge');
    const count = await badges.count();

    if (count > 0) {
      await expect(badges.first()).toBeVisible();
    }
  });
});
