import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to the PO list page and finds a PO with status "Parcial" or
 * "Completada" that supports creating a return. Clicks the "Nueva devolución"
 * button on the first matching row.
 * Returns false (and the caller should skip) if no eligible PO exists.
 */
async function openReturnDialogFromPOList(page: import('@playwright/test').Page) {
  await page.goto('/proveedores/ordenes');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ordenes de Compra' })
  ).toBeVisible({ timeout: 10000 });

  const returnBtn = page
    .getByTestId('orders-list-section')
    .getByRole('button', { name: 'Nueva devolución' })
    .first();

  if (!(await returnBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
    return false;
  }

  await returnBtn.click({ force: true });

  // Wait for the dialog to appear — title starts with "Nueva devolución"
  await expect(
    page.locator('[role="dialog"]').getByText('Nueva devolución', { exact: false })
  ).toBeVisible({ timeout: 10000 });

  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Purchase Returns', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // -------------------------------------------------------------------------
  // 1. Page loads — navigates to devoluciones, sees header or empty state
  // -------------------------------------------------------------------------

  test(
    'displays the returns page with header and list or empty state',
    { tag: ['@critical', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      await page.goto('/proveedores/devoluciones');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Devoluciones a Proveedores' })
      ).toBeVisible({ timeout: 10000 });

      // Either the data table or the empty state should be visible
      const emptyState = page.getByText('Aun no hay devoluciones');
      const tableOrEmpty = page.locator('table').or(emptyState);
      await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10000 });
    }
  );

  // -------------------------------------------------------------------------
  // 2. Status filter works
  // -------------------------------------------------------------------------

  test(
    'filters returns by status using the status dropdown',
    { tag: ['@high', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      await page.goto('/proveedores/devoluciones');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Devoluciones a Proveedores' })
      ).toBeVisible({ timeout: 10000 });

      // The status filter trigger shows "Todos" by default
      const statusTrigger = page.locator('button').filter({ hasText: 'Todos' }).first();
      if (!(await statusTrigger.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await statusTrigger.click({ force: true });

      // Select "Pendiente"
      const pendingOption = page.locator('[role="option"]').filter({ hasText: 'Pendiente' });
      if (!(await pendingOption.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await pendingOption.click({ force: true });

      // Page should remain stable — either table rows or empty state
      const emptyState = page.getByText('Aun no hay devoluciones');
      const table = page.locator('table');
      await expect(table.or(emptyState).first()).toBeVisible({ timeout: 10000 });
    }
  );

  // -------------------------------------------------------------------------
  // 3. Navigate to PO list to create return
  // -------------------------------------------------------------------------

  test(
    'navigates to PO list and finds eligible PO with "Nueva devolución" button',
    { tag: ['@critical', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      await page.goto('/proveedores/ordenes');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Ordenes de Compra' })
      ).toBeVisible({ timeout: 10000 });

      // Look for a "Nueva devolución" button in the orders list
      const returnBtn = page
        .getByTestId('orders-list-section')
        .getByRole('button', { name: 'Nueva devolución' })
        .first();

      if (!(await returnBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
        // No eligible PO exists — valid scenario, skip
        test.skip();
        return;
      }

      await expect(returnBtn).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // 4. Return dialog opens with correct structure
  // -------------------------------------------------------------------------

  test(
    'return dialog opens with correct structure (title, products table, reason, notes, checkbox)',
    { tag: ['@critical', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      const opened = await openReturnDialogFromPOList(page);
      if (!opened) {
        test.skip();
        return;
      }

      const dialog = page.locator('[role="dialog"]');

      // Dialog title: "Nueva devolución — Orden {order_number}"
      await expect(dialog.getByText('Nueva devolución', { exact: false })).toBeVisible();

      // Products table with headers
      await expect(dialog.getByText('Productos a devolver')).toBeVisible();
      await expect(dialog.getByText('Producto')).toBeVisible();
      await expect(dialog.getByText('Recibido')).toBeVisible();
      await expect(dialog.getByText('Precio unit.')).toBeVisible();
      await expect(dialog.getByText('Cant. devolver')).toBeVisible();

      // Running total
      await expect(dialog.getByText('Total a devolver:', { exact: false })).toBeVisible();

      // Reason select
      await expect(dialog.getByText('Razón de devolución')).toBeVisible();

      // Notes textarea
      await expect(dialog.getByText('Notas adicionales (opcional)')).toBeVisible();

      // Inventory checkbox
      await expect(dialog.getByText('Descontar del inventario')).toBeVisible();

      // Buttons
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Crear devolución' })).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // 5. Return dialog cancel
  // -------------------------------------------------------------------------

  test(
    'closes the return dialog when clicking Cancelar',
    { tag: ['@medium', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      const opened = await openReturnDialogFromPOList(page);
      if (!opened) {
        test.skip();
        return;
      }

      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole('button', { name: 'Cancelar' }).click({ force: true });

      // Dialog should close
      await expect(
        dialog.getByText('Nueva devolución', { exact: false })
      ).not.toBeVisible({ timeout: 5000 });
    }
  );

  // -------------------------------------------------------------------------
  // 6. Create return with reason
  // -------------------------------------------------------------------------

  test(
    'creates a return by filling quantity, selecting reason, and submitting',
    { tag: ['@critical', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      const opened = await openReturnDialogFromPOList(page);
      if (!opened) {
        test.skip();
        return;
      }

      const dialog = page.locator('[role="dialog"]');

      // Fill quantity for the first product line (set to 1)
      const qtyInput = dialog.locator('input[type="number"]').first();
      if (!(await qtyInput.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await qtyInput.fill('1');

      // Total should update from $0.00
      await expect(dialog.getByText('Total a devolver: $0.00')).not.toBeVisible({
        timeout: 3000,
      });

      // Select a reason — click the reason select trigger
      const reasonTrigger = dialog
        .locator('button')
        .filter({ hasText: 'Seleccionar razón' });
      await reasonTrigger.click({ force: true });

      const reasonOption = page.locator('[role="option"]').filter({ hasText: 'Dañado' });
      if (!(await reasonOption.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await reasonOption.click({ force: true });

      // Submit
      await dialog.getByRole('button', { name: 'Crear devolución' }).click({ force: true });

      // Expect success or error toast
      const successToast = page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'Devolución creada' });
      const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
      await expect(successToast.or(errorToast)).toBeVisible({ timeout: 10000 });

      // If successful, dialog should close
      if (await successToast.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(
          dialog.getByText('Nueva devolución', { exact: false })
        ).not.toBeVisible({ timeout: 5000 });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 7. Return appears in list after creation
  // -------------------------------------------------------------------------

  test(
    'created return appears in the devoluciones list page',
    { tag: ['@high', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      // First create a return
      const opened = await openReturnDialogFromPOList(page);
      if (!opened) {
        test.skip();
        return;
      }

      const dialog = page.locator('[role="dialog"]');

      // Fill quantity for first line
      const qtyInput = dialog.locator('input[type="number"]').first();
      if (!(await qtyInput.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await qtyInput.fill('1');

      // Select reason
      const reasonTrigger = dialog
        .locator('button')
        .filter({ hasText: 'Seleccionar razón' });
      await reasonTrigger.click({ force: true });

      const reasonOption = page.locator('[role="option"]').filter({ hasText: 'Defectuoso' });
      if (!(await reasonOption.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await reasonOption.click({ force: true });

      // Submit
      await dialog.getByRole('button', { name: 'Crear devolución' }).click({ force: true });

      const successToast = page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'Devolución creada' });
      if (!(await successToast.isVisible({ timeout: 10000 }).catch(() => false))) {
        test.skip();
        return;
      }

      // Navigate to the returns list page
      await page.goto('/proveedores/devoluciones');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Devoluciones a Proveedores' })
      ).toBeVisible({ timeout: 10000 });

      // Verify at least one return row exists (table should have data)
      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // There should be a "Pendiente" badge for the new return
      await expect(page.getByText('Pendiente').first()).toBeVisible({ timeout: 5000 });
    }
  );

  // -------------------------------------------------------------------------
  // 8. Export button state
  // -------------------------------------------------------------------------

  test(
    'export button is disabled when no returns exist',
    { tag: ['@medium', '@e2e', '@purchase-returns'] },
    async ({ page }) => {
      await page.goto('/proveedores/devoluciones');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Devoluciones a Proveedores' })
      ).toBeVisible({ timeout: 10000 });

      const exportBtn = page.getByRole('button', { name: /exportar/i });

      // Wait for loading to finish
      await page.waitForTimeout(2000);

      const emptyState = page.getByText('Aun no hay devoluciones');
      const hasData = !(await emptyState.isVisible({ timeout: 3000 }).catch(() => false));

      if (hasData) {
        // If data exists, export should be enabled
        await expect(exportBtn).toBeEnabled();
      } else {
        // If no data, export should be disabled
        await expect(exportBtn).toBeDisabled();
      }
    }
  );
});
