import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * REC-DETAIL-INV-3, REC-DETAIL-INV-4, REC-DETAIL-INV-5 — Recipe DETAIL
 * items management (add, duplicate guard, remove, save bulk PUT).
 *
 * Locks the pre-refactor unsaved-changes flow so PR-10 cannot regress:
 *   1) Open add-item dialog → product-select enabled after products load →
 *      pick product + fill quantity → confirm-add-item-btn enabled.
 *   2) Submit add-item → row appears + `(cambios sin guardar)` text +
 *      save-items-btn visible.
 *   3) Try to add the same product → toast "Este producto ya esta en la
 *      receta" + dialog stays open.
 *   4) Remove the row → confirm → row disappears; save-items-btn stays
 *      visible (hasChanges still true from the add).
 *   5) Save items → `(cambios sin guardar)` text + save-items-btn disappear.
 *
 * Linked to task D2.
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

async function openAddItemAndPickFirstProduct(
  page: Page,
  quantity: string,
): Promise<string> {
  await page.getByTestId('add-item-btn').click({ force: true });
  const select = page.getByTestId('product-select');
  await expect(select).toBeVisible({ timeout: 10000 });
  // Wait for the Select to be enabled (products fetch settles).
  await expect(select).toBeEnabled({ timeout: 15000 });
  await select.click({ force: true });

  // Pick the first available option from the Radix listbox.
  const firstOption = page.getByRole('option').first();
  await expect(firstOption).toBeVisible({ timeout: 10000 });
  const productLabel = (await firstOption.textContent())?.trim() ?? '';
  await firstOption.click({ force: true });

  await page.locator('#item-quantity').fill(quantity);
  await expect(page.getByTestId('confirm-add-item-btn')).toBeEnabled();
  return productLabel;
}

test.describe('Recipe DETAIL — items management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test(
    'enables confirm-add-item-btn after a product + quantity are picked',
    { tag: ['@e2e', '@recipe-detail', '@REC-DETAIL-INV-3'] },
    async ({ page }) => {
      const name = `Receta Items A ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await page.getByTestId('add-item-btn').click({ force: true });
      const select = page.getByTestId('product-select');
      await expect(select).toBeVisible({ timeout: 10000 });
      await expect(select).toBeEnabled({ timeout: 15000 });
      // Without a product picked, confirm should be disabled.
      await expect(page.getByTestId('confirm-add-item-btn')).toBeDisabled();

      await select.click({ force: true });
      const firstOption = page.getByRole('option').first();
      await expect(firstOption).toBeVisible({ timeout: 10000 });
      await firstOption.click({ force: true });

      // Still disabled — quantity is empty.
      await expect(page.getByTestId('confirm-add-item-btn')).toBeDisabled();
      await page.locator('#item-quantity').fill('3');
      await expect(page.getByTestId('confirm-add-item-btn')).toBeEnabled();
    },
  );

  test(
    'submitting add-item creates a row and shows the unsaved-changes badge',
    { tag: ['@critical', '@e2e', '@recipe-detail', '@REC-DETAIL-INV-3'] },
    async ({ page }) => {
      const name = `Receta Items B ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await openAddItemAndPickFirstProduct(page, '5');
      await page.getByTestId('confirm-add-item-btn').click({ force: true });

      // Dialog closes — quantity input no longer visible.
      await expect(page.locator('#item-quantity')).toBeHidden({
        timeout: 10000,
      });

      // Unsaved-changes badge + save button appear.
      await expect(page.getByText('(cambios sin guardar)')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId('save-items-btn')).toBeVisible();

      // One item row exists with a remove button.
      await expect(page.getByTestId('remove-item-btn')).toHaveCount(1);
    },
  );

  test(
    'duplicate-product add shows the toast and keeps the dialog open',
    { tag: ['@critical', '@e2e', '@recipe-detail', '@REC-DETAIL-INV-3'] },
    async ({ page }) => {
      const name = `Receta Items C ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      // First add succeeds.
      await openAddItemAndPickFirstProduct(page, '2');
      await page.getByTestId('confirm-add-item-btn').click({ force: true });
      await expect(page.locator('#item-quantity')).toBeHidden({
        timeout: 10000,
      });

      // Re-open and pick the same first product.
      await openAddItemAndPickFirstProduct(page, '1');
      await page.getByTestId('confirm-add-item-btn').click({ force: true });

      // Toast appears and dialog stays open.
      await expect(
        page.getByText('Este producto ya esta en la receta'),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#item-quantity')).toBeVisible();
    },
  );

  test(
    'remove-item drops the row but keeps hasChanges true',
    { tag: ['@e2e', '@recipe-detail', '@REC-DETAIL-INV-4'] },
    async ({ page }) => {
      const name = `Receta Items D ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await openAddItemAndPickFirstProduct(page, '4');
      await page.getByTestId('confirm-add-item-btn').click({ force: true });
      await expect(page.locator('#item-quantity')).toBeHidden({
        timeout: 10000,
      });
      await expect(page.getByTestId('remove-item-btn')).toHaveCount(1);
      await expect(page.getByTestId('save-items-btn')).toBeVisible();

      // Remove the only row.
      await page.getByTestId('remove-item-btn').click({ force: true });
      await page.getByTestId('confirm-delete-btn').click({ force: true });
      await expect(page.getByTestId('remove-item-btn')).toHaveCount(0, {
        timeout: 10000,
      });

      // save-items-btn STILL visible — the local-items have changed even
      // though the table is back to 0 rows.
      await expect(page.getByTestId('save-items-btn')).toBeVisible();
      await expect(page.getByText('(cambios sin guardar)')).toBeVisible();
    },
  );

  test(
    'save-items-btn persists changes and clears the badge',
    { tag: ['@critical', '@e2e', '@recipe-detail', '@REC-DETAIL-INV-5'] },
    async ({ page }) => {
      const name = `Receta Items E ${Date.now()}`;
      await seedRecipeViaUi(page, name);
      await openDetailByName(page, name);

      await openAddItemAndPickFirstProduct(page, '6');
      await page.getByTestId('confirm-add-item-btn').click({ force: true });
      await expect(page.getByTestId('save-items-btn')).toBeVisible({
        timeout: 10000,
      });

      await page.getByTestId('save-items-btn').click({ force: true });

      // Badge + button disappear after the bulk PUT settles.
      await expect(page.getByText('(cambios sin guardar)')).toBeHidden({
        timeout: 15000,
      });
      await expect(page.getByTestId('save-items-btn')).toBeHidden({
        timeout: 15000,
      });
      // The row remains (now backed by a real id from the server).
      await expect(page.getByTestId('remove-item-btn')).toHaveCount(1);
    },
  );
});
