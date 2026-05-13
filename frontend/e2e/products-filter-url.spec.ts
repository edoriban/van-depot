import { test, expect } from '@playwright/test';
import { login } from './helpers';

// PROD-LIST-INV-3 — Class chip + manufactured chip URL roundtrip.
//
// Covers the URL contract for ?class= and ?is_manufactured=true that today's
// UI implements but no e2e spec asserts. STRICT behavior equivalence — these
// tests must pass on the PRE-refactor main branch and continue to pass after
// PR-5.
test.describe('Products filter URL contract', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('clicking class-chip-raw-material sets ?class=raw_material', async ({
    page,
  }) => {
    await page.goto('/productos');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Productos' }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByTestId('class-chip-raw-material').click({ force: true });

    await expect(page).toHaveURL(/[?&]class=raw_material(&|$)/, {
      timeout: 10000,
    });
    await expect(page.getByTestId('class-chip-raw-material')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('manufactured chip preserves class param when both filters are active', async ({
    page,
  }) => {
    await page.goto('/productos?class=raw_material');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Productos' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('class-chip-raw-material')).toHaveAttribute(
      'data-active',
      'true',
      { timeout: 10000 },
    );

    await page.getByTestId('class-chip-manufactured').click({ force: true });

    await expect(page).toHaveURL(/[?&]class=raw_material(&|$)/, {
      timeout: 10000,
    });
    await expect(page).toHaveURL(/[?&]is_manufactured=true(&|$)/);
    await expect(page.getByTestId('class-chip-manufactured')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('class-chip-all drops the class param while preserving others', async ({
    page,
  }) => {
    await page.goto('/productos?class=raw_material&is_manufactured=true');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Productos' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('class-chip-raw-material')).toHaveAttribute(
      'data-active',
      'true',
      { timeout: 10000 },
    );

    await page.getByTestId('class-chip-all').click({ force: true });

    // class= must be gone; is_manufactured= must still be there.
    await expect(page).not.toHaveURL(/[?&]class=/, { timeout: 10000 });
    await expect(page).toHaveURL(/[?&]is_manufactured=true(&|$)/);
    await expect(page.getByTestId('class-chip-all')).toHaveAttribute(
      'data-active',
      'true',
    );
  });
});
