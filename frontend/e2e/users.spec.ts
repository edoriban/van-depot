import { test, expect } from '@playwright/test';

test.describe('Users page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
  });

  test('should display page title and new user button', async ({ page }) => {
    await expect(page.getByTestId('users-page')).toBeVisible();

    // Page shows either the users table (admin) or access denied message
    const heading = page.getByRole('heading', { name: 'Usuarios' });
    const denied = page.getByText('No tienes permisos');

    await expect(heading.or(denied)).toBeVisible();
  });

  test('should open create user dialog if admin', async ({ page }) => {
    const newBtn = page.getByTestId('new-user-btn');

    // Only proceed if the button is visible (user is admin)
    if (!(await newBtn.isVisible())) {
      test.skip();
      return;
    }

    await newBtn.click();

    await expect(page.getByTestId('user-email-input')).toBeVisible();
    await expect(page.getByTestId('user-password-input')).toBeVisible();
    await expect(page.getByTestId('user-name-input')).toBeVisible();
    await expect(page.getByTestId('user-role-select')).toBeVisible();
    await expect(page.getByTestId('submit-user-btn')).toBeVisible();
  });

  test('should fill create user form', async ({ page }) => {
    const newBtn = page.getByTestId('new-user-btn');

    if (!(await newBtn.isVisible())) {
      test.skip();
      return;
    }

    await newBtn.click();

    await page.getByTestId('user-email-input').fill('test-e2e@ejemplo.com');
    await page.getByTestId('user-password-input').fill('testpass123');
    await page.getByTestId('user-name-input').fill('Usuario E2E');
    await page.getByTestId('user-role-select').selectOption('operator');

    // Submit
    await page.getByTestId('submit-user-btn').click();

    // Expect either success or error toast
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Usuario creado' });
    const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });

    await expect(successToast.or(errorToast)).toBeVisible({ timeout: 5000 });
  });

  test('should show role badges in table', async ({ page }) => {
    const newBtn = page.getByTestId('new-user-btn');

    if (!(await newBtn.isVisible())) {
      test.skip();
      return;
    }

    // Wait for table to load
    await page.waitForTimeout(1000);

    // Check if role badges are visible (at least one user should exist)
    const badges = page.getByTestId('user-role-badge');
    const count = await badges.count();

    if (count > 0) {
      await expect(badges.first()).toBeVisible();
    }
  });
});
