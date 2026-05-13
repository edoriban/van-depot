import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// Covers WO-INV-3 (detail-page invariants) + the deep-link contract used by
// the WO detail → Movimientos breadcrumb roundtrip.
//
// The deep-link test deliberately uses a synthetic UUID for the chip-render
// assertion (the chip renders with the truncated id fallback even without a
// matching WO in the backend, mirroring `movements-wo-deeplink.spec.ts`).
//
// The detail-rendering tests deep-link into a real WO discovered through the
// list page so they survive arbitrary seed permutations: we open
// `/ordenes-de-trabajo`, find the first row whose status matches the chip
// under test, click its `work-order-detail-link`, and assert detail-page
// invariants (header, status badge, materials table, back link).

const SYNTHETIC_WO_ID = '00000000-0000-0000-0000-000000000abc';

async function gotoDetailFromList(page: Page): Promise<string | null> {
  await login(page);
  await page.goto('/ordenes-de-trabajo');
  await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
    timeout: 10000,
  });
  // Wait for the first detail link if there is one.
  const firstLink = page.getByTestId('work-order-detail-link').first();
  const isPresent = await firstLink
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!isPresent) return null;
  const href = await firstLink.getAttribute('href');
  await firstLink.click({ force: true });
  await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
    timeout: 10000,
  });
  return href;
}

test.describe('Work order detail — deep-link + breadcrumb + invariants', () => {
  test('renders detail page shell when reached from the list', async ({
    page,
  }) => {
    const href = await gotoDetailFromList(page);
    test.skip(href === null, 'No work orders seeded for this tenant');

    // Header + status badge + materials card all render.
    await expect(page.getByTestId('work-order-status-badge')).toBeVisible();
    // Back-to-list link uses href, not a testid — assert via text/role.
    await expect(
      page.getByRole('link', { name: /Ordenes de trabajo/ }),
    ).toBeVisible();
    // Materials section renders (rows may be empty but the card title is
    // load-bearing).
    await expect(page.getByText('Materiales')).toBeVisible();
  });

  test('back-to-list link returns to /ordenes-de-trabajo', async ({ page }) => {
    const href = await gotoDetailFromList(page);
    test.skip(href === null, 'No work orders seeded for this tenant');

    await page.getByRole('link', { name: /Ordenes de trabajo/ }).click({
      force: true,
    });
    await expect(page).toHaveURL(/\/ordenes-de-trabajo(\?.*)?$/);
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });
  });

  test('status badge data-status matches the WO status', async ({ page }) => {
    const href = await gotoDetailFromList(page);
    test.skip(href === null, 'No work orders seeded for this tenant');

    const status = await page
      .getByTestId('work-order-status-badge')
      .getAttribute('data-status');
    expect(['draft', 'in_progress', 'completed', 'cancelled']).toContain(
      status,
    );
  });

  test('a known-missing WO id renders the error fallback with a back link', async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/ordenes-de-trabajo/${SYNTHETIC_WO_ID}`);

    // Either the error fallback OR the loading skeleton renders briefly;
    // wait for the error fallback to appear (the detail GET will 404 fast).
    await expect(page.getByTestId('work-order-error')).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole('button', { name: 'Volver al listado' }),
    ).toBeVisible();
  });

  test('clicking back from the error state navigates to the list', async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/ordenes-de-trabajo/${SYNTHETIC_WO_ID}`);

    await expect(page.getByTestId('work-order-error')).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'Volver al listado' }).click({
      force: true,
    });
    await expect(page).toHaveURL(/\/ordenes-de-trabajo(\?.*)?$/);
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });
  });

  test('completed WO renders the FG lot panel and the Ver movimientos link', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=completed');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    const link = page.getByTestId('work-order-detail-link').first();
    const isPresent = await link
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!isPresent, 'No completed work orders in seed');

    await link.click({ force: true });
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    // Completed WOs render the FG lot panel (the lot may be resolving).
    await expect(page.getByTestId('wo-fg-lot-panel')).toBeVisible({
      timeout: 10000,
    });

    // The Ver movimientos breadcrumb link goes to `/movimientos?work_order_id=`.
    const moveLink = page.getByTestId('wo-movements-link');
    await expect(moveLink).toBeVisible();
    const href = await moveLink.getAttribute('href');
    expect(href).toMatch(/^\/movimientos\?work_order_id=/);
  });

  test('detail → movimientos deep-link roundtrip renders the WO filter chip', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=completed');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    const link = page.getByTestId('work-order-detail-link').first();
    const isPresent = await link
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!isPresent, 'No completed work orders in seed');

    await link.click({ force: true });
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    const moveLink = page.getByTestId('wo-movements-link');
    await expect(moveLink).toBeVisible();
    await moveLink.click({ force: true });

    await expect(page).toHaveURL(/\/movimientos\?work_order_id=/);
    await expect(page.getByTestId('movements-page')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('work-order-filter-chip')).toBeVisible({
      timeout: 10000,
    });
  });

  test('issue confirm dialog opens for a draft WO', async ({ page }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=draft');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    const link = page.getByTestId('work-order-detail-link').first();
    const isPresent = await link
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!isPresent, 'No draft work orders in seed');

    await link.click({ force: true });
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    const issueBtn = page.getByTestId('issue-wo-btn');
    await expect(issueBtn).toBeVisible();
    await issueBtn.click({ force: true });

    await expect(
      page.getByRole('dialog', { name: 'Entregar orden' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('cancel confirm dialog opens for an in_progress WO', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=in_progress');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    const link = page.getByTestId('work-order-detail-link').first();
    const isPresent = await link
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!isPresent, 'No in_progress work orders in seed');

    await link.click({ force: true });
    await expect(page.getByTestId('work-order-detail-page')).toBeVisible({
      timeout: 10000,
    });

    const cancelBtn = page.getByTestId('cancel-wo-btn');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click({ force: true });

    await expect(
      page.getByRole('dialog', { name: 'Cancelar orden en proceso' }),
    ).toBeVisible({ timeout: 5000 });
  });
});
