import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * REC-DETAIL-INV-1, REC-DETAIL-INV-2 — Recipe DETAIL page header + edit
 * metadata dialog.
 *
 * Locks the pre-refactor detail behavior so PR-10 (frontend-migration-recetas
 * Phase E) cannot regress:
 *   1) Navigating from the list to a recipe shows `recipe-detail-page` with
 *      the recipe name in the heading.
 *   2) The edit dialog opens with a pre-filled name, the submit closes the
 *      dialog, and the header `<h1>` reflects the new name after save.
 *   3) The `back-to-recipes` button returns to `/recetas` and the grid is
 *      visible.
 *
 * Linked to task D1 + spec invariants REC-DETAIL-INV-1, REC-DETAIL-INV-2.
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

test.describe('Recipe DETAIL — header + edit metadata', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    'navigates from list to detail and shows the header',
    { tag: ['@critical', '@e2e', '@recipe-detail', '@REC-DETAIL-INV-1'] },
    async ({ page }) => {
      const name = `Receta Detalle ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await expect(
        page.getByRole('heading', { level: 1, name }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('edit-recipe-btn')).toBeVisible();
      await expect(page.getByTestId('add-item-btn')).toBeVisible();
      // dispatch-wizard-btn must be disabled when there are no items.
      await expect(page.getByTestId('dispatch-wizard-btn')).toBeDisabled();
    },
  );

  test(
    'edits the recipe name from the detail page and the heading updates',
    { tag: ['@critical', '@e2e', '@recipe-detail', '@REC-DETAIL-INV-2'] },
    async ({ page }) => {
      const stamp = Date.now();
      const originalName = `Receta Editar ${stamp}`;
      const editedName = `${originalName} editada`;

      await seedRecipeViaUi(page, originalName);
      await openDetailByName(page, originalName);

      await expect(
        page.getByRole('heading', { level: 1, name: originalName }),
      ).toBeVisible();

      await page.getByTestId('edit-recipe-btn').click({ force: true });
      const nameInput = page.locator('#edit-recipe-name');
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      await expect(nameInput).toHaveValue(originalName);

      await nameInput.clear();
      await nameInput.fill(editedName);
      await page.getByTestId('edit-submit-btn').click({ force: true });

      // Dialog closes (input hidden) and heading reflects the new name.
      await expect(nameInput).toBeHidden({ timeout: 10000 });
      await expect(
        page.getByRole('heading', { level: 1, name: editedName }),
      ).toBeVisible({ timeout: 10000 });
    },
  );

  test(
    'back-to-recipes returns to /recetas',
    { tag: ['@e2e', '@recipe-detail', '@REC-DETAIL-INV-1'] },
    async ({ page }) => {
      const name = `Receta Back ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await page.getByTestId('back-to-recipes').click({ force: true });
      await expect(page).toHaveURL(/\/recetas\/?$/i, { timeout: 15000 });
      await expect(page.getByTestId('recetas-page')).toBeVisible({
        timeout: 15000,
      });
    },
  );
});
