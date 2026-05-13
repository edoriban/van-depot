import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * REC-DETAIL-INV-6 — Dispatch wizard launcher (open + close only).
 *
 * The dispatch wizard itself is carved out — this spec only asserts that the
 * launcher button opens it and that the button is disabled when the recipe
 * has no items. Wizard step advancement (step 1 / 2 / 3) is intentionally
 * out of scope per spec §9 question 1.
 *
 * Linked to task D3.
 */

async function seedRecipeViaUi(page: Page, name: string): Promise<void> {
  await page.goto('/recetas');
  await expect(page.getByTestId('recetas-page')).toBeVisible({
    timeout: 15000,
  });
  await page.getByTestId('new-recipe-btn').click({ force: true });
  await expect(page.locator('#recipe-name')).toBeVisible({ timeout: 10000 });
  await page.locator('#recipe-name').fill(name);
  await page.getByTestId('submit-btn').click({ force: true });
  await expect(
    page.getByTestId('recipe-grid').getByText(name).first(),
  ).toBeVisible({ timeout: 15000 });
}

async function openDetailByName(page: Page, name: string): Promise<void> {
  const card = page
    .getByTestId('recipe-card')
    .filter({ hasText: name })
    .first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByTestId('recipe-detail-link').click({ force: true });
  await expect(page).toHaveURL(/\/recetas\/[a-f0-9-]+/i, { timeout: 15000 });
  await expect(page.getByTestId('recipe-detail-page')).toBeVisible({
    timeout: 15000,
  });
}

async function addFirstProductWithQuantity(
  page: Page,
  quantity: string,
): Promise<void> {
  await page.getByTestId('add-item-btn').click({ force: true });
  const select = page.getByTestId('product-select');
  await expect(select).toBeVisible({ timeout: 10000 });
  await expect(select).toBeEnabled({ timeout: 15000 });
  await select.click({ force: true });
  const firstOption = page.getByRole('option').first();
  await expect(firstOption).toBeVisible({ timeout: 10000 });
  await firstOption.click({ force: true });
  await page.locator('#item-quantity').fill(quantity);
  await page.getByTestId('confirm-add-item-btn').click({ force: true });
  await expect(page.locator('#item-quantity')).toBeHidden({
    timeout: 10000,
  });
  // Save so the wizard sees server-side items (the wizard reads recipe.items
  // from its own fetch, not from the local-only state).
  await page.getByTestId('save-items-btn').click({ force: true });
  await expect(page.getByTestId('save-items-btn')).toBeHidden({
    timeout: 15000,
  });
}

test.describe('Recipe DETAIL — dispatch wizard launcher', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    'opens the dispatch wizard from the launcher and closes via Escape',
    { tag: ['@e2e', '@recipe-detail', '@REC-DETAIL-INV-6'] },
    async ({ page }) => {
      const name = `Receta Dispatch A ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);
      await addFirstProductWithQuantity(page, '2');

      const launcher = page.getByTestId('dispatch-wizard-btn');
      await expect(launcher).toBeEnabled({ timeout: 10000 });
      await launcher.click({ force: true });

      const wizard = page.getByTestId('dispatch-wizard');
      await expect(wizard).toBeVisible({ timeout: 10000 });

      await page.keyboard.press('Escape');
      await expect(wizard).toBeHidden({ timeout: 10000 });
      await expect(page.getByTestId('recipe-detail-page')).toBeVisible();
    },
  );

  test(
    'disables the dispatch-wizard-btn when the recipe has no items',
    { tag: ['@e2e', '@recipe-detail', '@REC-DETAIL-INV-6'] },
    async ({ page }) => {
      const name = `Receta Dispatch B ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      // Freshly created recipe — no items yet.
      await expect(page.getByTestId('dispatch-wizard-btn')).toBeDisabled();
    },
  );
});
