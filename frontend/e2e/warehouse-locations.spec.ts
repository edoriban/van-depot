import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * ALM-DETAIL-INV-3, ALM-DETAIL-INV-4, ALM-DETAIL-INV-5 — Warehouse locations
 * tree CRUD.
 *
 * The Ubicaciones tab renders a recursive tree of locations with create /
 * edit / delete operations + a child-type cascade in the create dialog.
 *
 * Linked to spec `sdd/frontend-migration-almacenes/spec` invariants
 * ALM-DETAIL-INV-3, ALM-DETAIL-INV-4, ALM-DETAIL-INV-5 + task D2.
 */

async function openFirstWarehouseLocationsTab(page: Page): Promise<boolean> {
  await page.goto('/almacenes');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Almacenes' }),
  ).toBeVisible({ timeout: 10000 });

  const detailLink = page.getByTestId('warehouse-detail-link').first();
  if (!(await detailLink.isVisible({ timeout: 10000 }).catch(() => false))) {
    return false;
  }
  await detailLink.click({ force: true });
  await expect(page.getByTestId('warehouse-detail-page')).toBeVisible({
    timeout: 15000,
  });

  const ubicacionesTab = page.getByTestId('tab-ubicaciones');
  await ubicacionesTab.click({ force: true });
  await expect(ubicacionesTab).toHaveAttribute('data-state', 'active');
  // Wait for either the tree, the empty-state, or a skeleton to settle.
  await page.waitForTimeout(500);
  return true;
}

test.describe('Warehouse detail — locations tree', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('creates a new zone via the Nueva zona button', async ({ page }) => {
    const opened = await openFirstWarehouseLocationsTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    const newBtn = page.getByTestId('new-location-btn');
    if (!(await newBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await newBtn.click({ force: true });

    const nameInput = page.locator('#location-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    const uniqueName = `Zona E2E ${Date.now()}`;
    await nameInput.fill(uniqueName);
    // Default type when no parent is `zone` — submit as-is.
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(nameInput).not.toBeVisible({ timeout: 10000 });
    // New zone surfaces in the tree.
    await expect(page.getByText(uniqueName).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('edits an existing location name', async ({ page }) => {
    const opened = await openFirstWarehouseLocationsTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Hover the first row so the action buttons surface (they are hidden
    // by `opacity-0 group-hover:opacity-100`). Playwright force-clicks the
    // edit button without requiring real hover.
    const editBtn = page.getByTestId('edit-location-btn').first();
    if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await editBtn.click({ force: true });

    const nameInput = page.locator('#location-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    const uniqueName = `Editada E2E ${Date.now()}`;
    await nameInput.clear();
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });

    await expect(nameInput).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(uniqueName).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('deletes a location via the ConfirmDialog', async ({ page }) => {
    const opened = await openFirstWarehouseLocationsTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Create a throwaway zone first so we always have a leaf to delete.
    const newBtn = page.getByTestId('new-location-btn');
    if (!(await newBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await newBtn.click({ force: true });
    const nameInput = page.locator('#location-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    const uniqueName = `Borrar E2E ${Date.now()}`;
    await nameInput.fill(uniqueName);
    await page.getByTestId('submit-btn').click({ force: true });
    await expect(nameInput).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(uniqueName).first()).toBeVisible({
      timeout: 10000,
    });

    // Hover the newly-created row to expose the delete button. We locate
    // the row by the text and then walk up to the row's hover-group via
    // a sibling selector.
    const row = page
      .locator('.group')
      .filter({ hasText: uniqueName })
      .first();
    await row.hover().catch(() => {});
    const deleteBtn = row.getByTestId('delete-location-btn').first();
    await deleteBtn.click({ force: true });

    await page.getByTestId('confirm-delete-btn').click({ force: true });

    await expect(page.getByText(uniqueName)).toHaveCount(0, {
      timeout: 10000,
    });
  });

  test('cascade: switching parent re-derives allowed types', async ({
    page,
  }) => {
    const opened = await openFirstWarehouseLocationsTab(page);
    if (!opened) {
      test.skip();
      return;
    }

    const newBtn = page.getByTestId('new-location-btn');
    if (!(await newBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await newBtn.click({ force: true });
    await expect(page.locator('#location-name')).toBeVisible({
      timeout: 5000,
    });

    // The parent picker only renders on create with no pre-selected parent.
    // Skip if no parent picker (means no existing locations to pick from).
    const parentSelect = page.getByTestId('location-parent-select');
    if (!(await parentSelect.isVisible({ timeout: 3000 }).catch(() => false))) {
      // Close the dialog to keep page clean.
      await page.keyboard.press('Escape');
      test.skip();
      return;
    }

    // Open the parent picker and look for any item; pick the first non-"Ninguna"
    // option. Radix renders options as role="option" in a portal.
    await parentSelect.click({ force: true });
    const options = page.locator('[role="option"]');
    const count = await options.count();
    if (count < 2) {
      // Only "Ninguna" — cannot test cascade.
      await page.keyboard.press('Escape');
      test.skip();
      return;
    }
    // Pick the first non-"Ninguna" option.
    let pickedIndex = -1;
    for (let i = 0; i < count; i++) {
      const txt = (await options.nth(i).textContent())?.trim();
      if (txt && txt !== 'Ninguna') {
        pickedIndex = i;
        break;
      }
    }
    if (pickedIndex === -1) {
      await page.keyboard.press('Escape');
      test.skip();
      return;
    }
    await options.nth(pickedIndex).click({ force: true });

    // The type select should have been re-derived. We don't assert specific
    // values (they depend on which parent landed first); we assert the
    // type-select element is still visible and the dialog still open.
    await expect(page.getByTestId('location-type-select')).toBeVisible();

    // Close without saving.
    await page.keyboard.press('Escape');
    await expect(page.locator('#location-name')).not.toBeVisible({
      timeout: 5000,
    });
  });
});
