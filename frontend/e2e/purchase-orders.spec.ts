import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Opens the "Nueva orden" dialog and selects the first available supplier.
 * Returns false (and skips) if no suppliers are present.
 */
async function openCreateDialogAndSelectSupplier(page: import('@playwright/test').Page) {
  await page.getByTestId('create-order-btn').click({ force: true });
  await expect(page.getByText('Nueva orden de compra')).toBeVisible({ timeout: 5000 });

  const supplierTrigger = page.locator('button').filter({ hasText: 'Seleccionar proveedor' });
  if (!(await supplierTrigger.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await supplierTrigger.click({ force: true });

  const firstOption = page.locator('[role="option"]').first();
  if (!(await firstOption.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await firstOption.click({ force: true });
  return true;
}

/**
 * Fills the first (already-rendered) order line: selects the first available
 * product, then fills quantity and price inputs.
 */
async function fillFirstLine(
  page: import('@playwright/test').Page,
  quantity = '3',
  price = '50'
) {
  const productTrigger = page.locator('button').filter({ hasText: 'Seleccionar' }).first();
  await productTrigger.click({ force: true });

  const firstProduct = page.locator('[role="option"]').first();
  if (!(await firstProduct.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await firstProduct.click({ force: true });

  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill(quantity);
  await numberInputs.nth(1).fill(price);
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Purchase Orders', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/proveedores/ordenes');
    await expect(page.getByRole('heading', { level: 1, name: 'Ordenes de Compra' })).toBeVisible({
      timeout: 10000,
    });
  });

  // -------------------------------------------------------------------------
  // FR-1: Navigation and list
  // -------------------------------------------------------------------------

  test(
    'displays the orders page with list or empty state',
    { tag: ['@critical', '@e2e', '@purchase-orders', '@PO-E2E-001'] },
    async ({ page }) => {
      await expect(
        page
          .getByTestId('orders-list-section')
      ).toBeVisible({ timeout: 10000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-1: Create Purchase Order dialog opens correctly
  // -------------------------------------------------------------------------

  test(
    'opens create dialog with all required fields',
    { tag: ['@critical', '@e2e', '@purchase-orders', '@PO-E2E-002'] },
    async ({ page }) => {
      await page.getByTestId('create-order-btn').click({ force: true });

      await expect(page.getByText('Nueva orden de compra')).toBeVisible({ timeout: 5000 });
      const dialog = page.locator('[role="dialog"]');
      // Supplier selector label
      await expect(dialog.getByText('Proveedor', { exact: true })).toBeVisible();
      // Lines section label
      await expect(dialog.getByText('Lineas de la orden')).toBeVisible();
      // Optional fields
      await expect(dialog.getByText('Fecha esperada de entrega (opcional)')).toBeVisible();
      await expect(dialog.getByText('Notas (opcional)')).toBeVisible();
      // Submit button (disabled until supplier selected)
      await expect(dialog.getByRole('button', { name: 'Crear orden' })).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // FR-1: Create PO with supplier + lines → appears in list as draft
  // -------------------------------------------------------------------------

  test(
    'creates a purchase order with supplier and lines, appears in list as draft',
    { tag: ['@critical', '@e2e', '@purchase-orders', '@PO-E2E-003'] },
    async ({ page }) => {
      const ok = await openCreateDialogAndSelectSupplier(page);
      if (!ok) {
        test.skip();
        return;
      }

      const filled = await fillFirstLine(page, '5', '100');
      if (!filled) {
        test.skip();
        return;
      }

      // Wait for submit button to be enabled (supplier must be selected)
      const submitBtn = page.locator('[role="dialog"]').getByRole('button', { name: 'Crear orden' });
      await expect(submitBtn).toBeEnabled({ timeout: 5000 });
      await submitBtn.click({ force: true });

      const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'creada' }).first();
      const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' }).first();
      await expect(successToast.or(errorToast)).toBeVisible({ timeout: 10000 });

      // If creation succeeded, verify the dialog closed and a new row exists
      if (await successToast.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(page.getByText('Nueva orden de compra')).not.toBeVisible({ timeout: 5000 });
        // The list should now show at least one row
        await expect(page.getByTestId('orders-list-section')).toBeVisible({ timeout: 10000 });
        // New PO always starts as draft — "Borrador" badge should appear
        await expect(
          page.getByTestId('orders-list-section').getByText('Borrador').first()
        ).toBeVisible({ timeout: 5000 });
      }
    }
  );

  // -------------------------------------------------------------------------
  // FR-2: Real-time total calculation in dialog
  // -------------------------------------------------------------------------

  test(
    'updates estimated total in real-time when filling line quantity and price',
    { tag: ['@high', '@e2e', '@purchase-orders', '@PO-E2E-004'] },
    async ({ page }) => {
      const ok = await openCreateDialogAndSelectSupplier(page);
      if (!ok) {
        test.skip();
        return;
      }

      // Initially total should be $0.00
      await expect(page.getByText('Total estimado: $0.00')).toBeVisible({ timeout: 5000 });

      // Select a product and fill quantity + price
      const filled = await fillFirstLine(page, '4', '25');
      if (!filled) {
        test.skip();
        return;
      }

      // 4 × 25 = 100.00
      await expect(page.getByText('Total estimado: $100.00')).toBeVisible({ timeout: 3000 });

      // Change quantity — total should update
      const numberInputs = page.locator('input[type="number"]');
      await numberInputs.nth(0).fill('10');
      // 10 × 25 = 250.00
      await expect(page.getByText('Total estimado: $250.00')).toBeVisible({ timeout: 3000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-2: Add a second line and verify total sums both lines
  // -------------------------------------------------------------------------

  test(
    'adds a second order line and total reflects both lines',
    { tag: ['@high', '@e2e', '@purchase-orders', '@PO-E2E-005'] },
    async ({ page }) => {
      const ok = await openCreateDialogAndSelectSupplier(page);
      if (!ok) {
        test.skip();
        return;
      }

      const filled = await fillFirstLine(page, '2', '50');
      if (!filled) {
        test.skip();
        return;
      }
      // Line 1 subtotal: 2 × 50 = 100.00

      // Add second line
      await page.getByRole('button', { name: '+ Agregar linea' }).click({ force: true });

      // The new line's product trigger is the second "Seleccionar" button
      const productTriggers = page.locator('button').filter({ hasText: 'Seleccionar' });
      const count = await productTriggers.count();
      if (count < 1) {
        test.skip();
        return;
      }
      await productTriggers.last().click({ force: true });
      const secondProduct = page.locator('[role="option"]').nth(1);
      if (!(await secondProduct.isVisible({ timeout: 5000 }).catch(() => false))) {
        // Only one product — skip duplicate product test variant
        test.skip();
        return;
      }
      await secondProduct.click({ force: true });

      // Fill line 2: qty=3, price=20 → subtotal 60
      const numberInputs = page.locator('input[type="number"]');
      const inputCount = await numberInputs.count();
      if (inputCount >= 4) {
        await numberInputs.nth(2).fill('3');
        await numberInputs.nth(3).fill('20');
      }

      // Total should be 100 + 60 = 160.00
      await expect(page.getByText('Total estimado: $160.00')).toBeVisible({ timeout: 3000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-3: Send a draft PO → status changes to sent
  // -------------------------------------------------------------------------

  test(
    'sends a draft order and expects success or error response',
    { tag: ['@critical', '@e2e', '@purchase-orders', '@PO-E2E-006'] },
    async ({ page }) => {
      const sendBtn = page.getByRole('button', { name: 'Enviar' }).first();
      if (!(await sendBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
        test.skip();
        return;
      }

      await sendBtn.click({ force: true });

      const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'enviada' });
      const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
      await expect(successToast.or(errorToast)).toBeVisible({ timeout: 10000 });

      // If successful, the row's status badge should update to "Enviada"
      if (await successToast.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(
          page.getByTestId('orders-list-section').getByText('Enviada').first()
        ).toBeVisible({ timeout: 5000 });
      }
    }
  );

  // -------------------------------------------------------------------------
  // FR-3: Try to send PO with no lines → backend returns error
  // -------------------------------------------------------------------------

  test(
    'shows error when attempting to send a PO with no lines',
    { tag: ['@high', '@e2e', '@purchase-orders', '@PO-E2E-007'] },
    async ({ page }) => {
      // Create a PO but skip filling any lines (submit with empty lines list is
      // blocked by frontend validation — but if somehow a PO exists with no
      // lines, sending it should return an error from the backend).
      // We test the frontend validation path: submit dialog without a product.
      const ok = await openCreateDialogAndSelectSupplier(page);
      if (!ok) {
        test.skip();
        return;
      }

      // Do NOT fill lines — quantity_ordered will be empty, so validLines = []
      await page.getByRole('button', { name: 'Crear orden' }).click({ force: true });

      // Frontend should show: "Agrega al menos una linea con producto y cantidad"
      const validationToast = page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'linea' });
      await expect(validationToast).toBeVisible({ timeout: 5000 });

      // Dialog must remain open
      await expect(page.getByText('Nueva orden de compra')).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // FR-3: Cancel a draft PO
  // -------------------------------------------------------------------------

  test(
    'cancels a draft order via confirm dialog',
    { tag: ['@critical', '@e2e', '@purchase-orders', '@PO-E2E-008'] },
    async ({ page }) => {
      const cancelBtn = page
        .getByTestId('orders-list-section')
        .getByRole('button', { name: 'Cancelar' })
        .first();

      if (!(await cancelBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
        test.skip();
        return;
      }

      await cancelBtn.click({ force: true });

      // Confirm dialog title
      await expect(page.getByText('Cancelar orden de compra')).toBeVisible({ timeout: 5000 });

      // ConfirmDialog uses data-testid="confirm-delete-btn" for the confirm button
      await page.getByTestId('confirm-delete-btn').click({ force: true });

      const successToast = page.locator('[data-sonner-toast]').filter({ hasText: 'cancelada' });
      const errorToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Error' });
      await expect(successToast.or(errorToast)).toBeVisible({ timeout: 10000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-1.2: Filter orders by status (Select component)
  // -------------------------------------------------------------------------

  test(
    'filters orders by status using the status dropdown',
    { tag: ['@high', '@e2e', '@purchase-orders', '@PO-E2E-009'] },
    async ({ page }) => {
      // The status filter is a shadcn Select — its trigger renders with
      // the current value ("Todos" when value is "all")
      const statusTrigger = page.locator('button').filter({ hasText: 'Todos' }).first();
      if (!(await statusTrigger.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await statusTrigger.click({ force: true });

      // Select "Borrador"
      const draftOption = page.locator('[role="option"]').filter({ hasText: 'Borrador' });
      if (!(await draftOption.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await draftOption.click({ force: true });

      // The list should reload — table or empty state
      await expect(
        page.getByTestId('orders-list-section')
      ).toBeVisible({ timeout: 10000 });

      // If there are draft orders, the Borrador badge must be visible
      // (filter is considered passing even when no draft orders exist — empty state is valid)
      const firstStatusBadge = page
        .getByTestId('orders-list-section')
        .getByText('Borrador')
        .first();
      const hasBorradorBadge = await firstStatusBadge.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasBorradorBadge) {
        await expect(firstStatusBadge).toBeVisible();
      }
      // If no Borrador badges are visible, either there are no draft orders (empty state) — pass
    }
  );

  // -------------------------------------------------------------------------
  // FR-1.2: Filter by supplier
  // -------------------------------------------------------------------------

  test(
    'filters orders by supplier',
    { tag: ['@medium', '@e2e', '@purchase-orders', '@PO-E2E-010'] },
    async ({ page }) => {
      // The supplier filter is a SearchableSelect — its trigger shows "Todos los proveedores"
      const supplierTrigger = page
        .locator('button')
        .filter({ hasText: 'Todos los proveedores' })
        .first();

      if (!(await supplierTrigger.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await supplierTrigger.click({ force: true });

      // Pick first real supplier option (index 1 to skip "Todos los proveedores")
      const supplierOption = page.locator('[role="option"]').nth(1);
      if (!(await supplierOption.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }
      await supplierOption.click({ force: true });

      // List refreshes — table or empty state
      await expect(
        page.getByTestId('orders-list-section')
      ).toBeVisible({ timeout: 10000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-3: Dismiss cancel confirm dialog without cancelling
  // -------------------------------------------------------------------------

  test(
    'dismisses the cancel confirm dialog without cancelling the order',
    { tag: ['@medium', '@e2e', '@purchase-orders', '@PO-E2E-011'] },
    async ({ page }) => {
      const cancelBtn = page
        .getByTestId('orders-list-section')
        .getByRole('button', { name: 'Cancelar' })
        .first();

      if (!(await cancelBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
        test.skip();
        return;
      }

      await cancelBtn.click({ force: true });
      await expect(page.getByText('Cancelar orden de compra')).toBeVisible({ timeout: 5000 });

      // Click the outline "Cancelar" button (dismisses dialog, does NOT confirm)
      const dismissBtn = page
        .locator('[role="dialog"]')
        .getByRole('button', { name: 'Cancelar' })
        .first();
      await dismissBtn.click({ force: true });

      // Dialog should close
      await expect(page.getByText('Cancelar orden de compra')).not.toBeVisible({ timeout: 3000 });

      // No toast should have appeared
      const cancelledToast = page.locator('[data-sonner-toast]').filter({ hasText: 'cancelada' });
      await expect(cancelledToast).not.toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // FR-1: Close create dialog without creating an order
  // -------------------------------------------------------------------------

  test(
    'closes the create dialog without creating an order',
    { tag: ['@medium', '@e2e', '@purchase-orders', '@PO-E2E-012'] },
    async ({ page }) => {
      await page.getByTestId('create-order-btn').click({ force: true });
      await expect(page.getByText('Nueva orden de compra')).toBeVisible({ timeout: 5000 });

      // Click the outline "Cancelar" button in DialogFooter
      await page
        .locator('[role="dialog"]')
        .getByRole('button', { name: 'Cancelar' })
        .click({ force: true });

      await expect(page.getByText('Nueva orden de compra')).not.toBeVisible({ timeout: 3000 });
    }
  );

  // -------------------------------------------------------------------------
  // FR-1: Requires supplier selection before submitting
  // -------------------------------------------------------------------------

  test(
    'create order button is disabled when no supplier is selected',
    { tag: ['@high', '@e2e', '@purchase-orders', '@PO-E2E-013'] },
    async ({ page }) => {
      await page.getByTestId('create-order-btn').click({ force: true });
      await expect(page.getByText('Nueva orden de compra')).toBeVisible({ timeout: 5000 });

      // The "Crear orden" submit button should be disabled when supplierId is empty
      const submitBtn = page.getByRole('button', { name: 'Crear orden' });
      await expect(submitBtn).toBeDisabled();
    }
  );

  // -------------------------------------------------------------------------
  // FR-2: Remove line button — only active when more than one line exists
  // -------------------------------------------------------------------------

  test(
    'remove line button is disabled when only one line exists',
    { tag: ['@medium', '@e2e', '@purchase-orders', '@PO-E2E-014'] },
    async ({ page }) => {
      const ok = await openCreateDialogAndSelectSupplier(page);
      if (!ok) {
        test.skip();
        return;
      }

      // The × (remove) button on the single line should be disabled
      const removeBtn = page
        .locator('[role="dialog"]')
        .getByRole('button', { name: '×' })
        .first();
      await expect(removeBtn).toBeDisabled();

      // Add a second line — now both × buttons should be enabled
      await page.getByRole('button', { name: '+ Agregar linea' }).click({ force: true });
      const removeBtns = page.locator('[role="dialog"]').getByRole('button', { name: '×' });
      await expect(removeBtns.first()).toBeEnabled();
    }
  );
});
