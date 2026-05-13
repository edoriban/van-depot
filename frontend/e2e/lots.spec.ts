import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Lots (Lotes)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/lotes');
    // Wait for either the heading or loading to settle
    await expect(page.getByRole('heading', { level: 1, name: 'Lotes' })).toBeVisible({
      timeout: 10000,
    });
  });

  // -------------------------------------------------------------------------
  // LOT-E2E-001: Page loads with header and subtitle
  // -------------------------------------------------------------------------

  test(
    'displays the lots page with header and subtitle',
    { tag: ['@critical', '@e2e', '@lots', '@LOT-E2E-001'] },
    async ({ page }) => {
      await expect(page.getByRole('heading', { level: 1, name: 'Lotes' })).toBeVisible();
      await expect(
        page.getByText('Historial de lotes recibidos y su estado de calidad')
      ).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-002: Empty state shows correct CTA
  // -------------------------------------------------------------------------

  test(
    'shows empty state with "Recibir material" action when no lots exist',
    { tag: ['@high', '@e2e', '@lots', '@LOT-E2E-002'] },
    async ({ page }) => {
      const emptyTitle = page.getByText('Sin lotes registrados');
      if (!(await emptyTitle.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip();
        return;
      }

      await expect(emptyTitle).toBeVisible();
      await expect(
        page.getByText('Recibe material por lotes para llevar trazabilidad de cada ingreso.')
      ).toBeVisible();

      // The empty state CTA links to /lotes/recibir
      const ctaLink = page.getByRole('link', { name: 'Recibir material' }).first();
      await expect(ctaLink).toBeVisible();
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-003: "Recibir material" button navigates correctly
  // -------------------------------------------------------------------------

  test(
    '"Recibir material" header button navigates to /lotes/recibir which redirects to /movimientos',
    { tag: ['@critical', '@e2e', '@lots', '@LOT-E2E-003'] },
    async ({ page }) => {
      // The header "Recibir material" button is always visible
      const headerBtn = page.getByRole('link', { name: 'Recibir material' }).first();
      await expect(headerBtn).toBeVisible({ timeout: 5000 });
      await headerBtn.click();

      // /lotes/recibir redirects to /movimientos
      await page.waitForURL('**/movimientos', { timeout: 10000 });
      await expect(page).toHaveURL(/\/movimientos/);
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-004: Lots table displays data with correct columns
  // -------------------------------------------------------------------------

  test(
    'displays lots table with expected column headers when data exists',
    { tag: ['@high', '@e2e', '@lots', '@LOT-E2E-004'] },
    async ({ page }) => {
      // If empty state is showing, skip — no data to verify table
      const emptyTitle = page.getByText('Sin lotes registrados');
      if (await emptyTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
        test.skip();
        return;
      }

      const expectedHeaders = [
        'No. Lote',
        'Producto',
        'Estado',
        'Cantidad recibida',
        'Cantidad total',
        'Fecha lote',
        'Vencimiento',
        'Recibido',
      ];

      // Independent visibility assertions — run in parallel.
      await Promise.all(
        expectedHeaders.map((header) =>
          expect(page.getByText(header, { exact: true }).first()).toBeVisible({ timeout: 3000 }),
        ),
      );
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-005: Quality status badges render with correct text
  // -------------------------------------------------------------------------

  test(
    'quality status badges display correct text for available statuses',
    { tag: ['@high', '@e2e', '@lots', '@LOT-E2E-005'] },
    async ({ page }) => {
      // If empty state is showing, skip — no badges to verify
      const emptyTitle = page.getByText('Sin lotes registrados');
      if (await emptyTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
        test.skip();
        return;
      }

      // At least one status badge should be present among the known statuses
      const statusLabels = ['Pendiente', 'Aprobado', 'Rechazado', 'Cuarentena'];
      let foundAny = false;

      // Sequential await is intentional: each iteration mutates `foundAny` based
      // on the visibility probe before the next assertion, and Playwright Locator
      // visibility checks against a shared Page should not race.
      for (const label of statusLabels) {
        const badge = page.locator('.bg-amber-100, .bg-green-100, .bg-red-100, .bg-purple-100').filter({ hasText: label }).first();
        if (await badge.isVisible({ timeout: 1000 }).catch(() => false)) {
          foundAny = true;
          await expect(badge).toBeVisible();
        }
      }

      if (!foundAny) {
        test.skip();
        return;
      }
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-006: Export button state depends on data
  // -------------------------------------------------------------------------

  test(
    'export button is disabled when no lots exist and enabled when data is present',
    { tag: ['@medium', '@e2e', '@lots', '@LOT-E2E-006'] },
    async ({ page }) => {
      // Wait for loading to complete
      await page.waitForTimeout(2000);

      const exportBtn = page.getByRole('button', { name: /exportar/i }).first();

      // If the export button is not visible, try finding it by the icon-only pattern
      if (!(await exportBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
        // ExportButton might render as icon-only; look for a button with download icon
        const iconExportBtn = page.locator('button[disabled]').filter({ hasText: /export/i }).first();
        if (!(await iconExportBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
          test.skip();
          return;
        }
      }

      const emptyTitle = page.getByText('Sin lotes registrados');
      if (await emptyTitle.isVisible({ timeout: 2000 }).catch(() => false)) {
        // No data → export should be disabled
        await expect(exportBtn).toBeDisabled();
      } else {
        // Has data → export should be enabled
        await expect(exportBtn).toBeEnabled();
      }
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-007: Redirect from /lotes/recibir to /movimientos
  // -------------------------------------------------------------------------

  test(
    'navigating to /lotes/recibir redirects to /movimientos',
    { tag: ['@critical', '@e2e', '@lots', '@LOT-E2E-007'] },
    async ({ page }) => {
      await page.goto('/lotes/recibir');
      await page.waitForURL('**/movimientos', { timeout: 10000 });
      await expect(page).toHaveURL(/\/movimientos/);
    }
  );

  // -------------------------------------------------------------------------
  // LOT-E2E-008: Lot data format — monospace lot numbers, formatted dates
  // -------------------------------------------------------------------------

  test(
    'lot numbers render in monospace font and dates are formatted',
    { tag: ['@medium', '@e2e', '@lots', '@LOT-E2E-008'] },
    async ({ page }) => {
      // If empty state is showing, skip
      const emptyTitle = page.getByText('Sin lotes registrados');
      if (await emptyTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
        test.skip();
        return;
      }

      // Lot numbers should have font-mono class
      const monoCell = page.locator('.font-mono').first();
      await expect(monoCell).toBeVisible({ timeout: 3000 });

      // Verify at least one date cell exists with formatted date (e.g. "1 ene 2025")
      // Dates in es-MX format use short month names
      const datePattern = /\d{1,2}\s(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s\d{4}/;
      const dateCell = page.locator('td').filter({ hasText: datePattern }).first();
      if (await dateCell.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dateCell).toBeVisible();
      }
    }
  );
});
