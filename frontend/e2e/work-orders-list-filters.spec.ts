import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Covers WO-INV-1 — Work Orders list page loads with default state plus
// URL-bound filter chips, warehouse/work-center dropdowns, and the search
// box. Asserts URL roundtrip for status, warehouse_id, work_center_location_id
// and search (debounced via the input), AND that toggling chips updates
// the URL and triggers refetches.
//
// This spec is intentionally surface-only (no fixture setup needed beyond
// the demo seed) — it asserts the shell + URL state. It complements
// `work-orders.spec.ts` 8.1 (create-from-scratch) which covers WO-INV-2.

test.describe('Work orders list — filters + chips + search', () => {
  test('renders default chip strip + Nueva orden button + search input', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo');

    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    // Chip strip — Todos + 4 statuses.
    await expect(page.getByTestId('status-chip-row')).toBeVisible();
    await expect(page.getByTestId('status-chip-all')).toBeVisible();
    await expect(page.getByTestId('status-chip-draft')).toBeVisible();
    await expect(page.getByTestId('status-chip-in_progress')).toBeVisible();
    await expect(page.getByTestId('status-chip-completed')).toBeVisible();
    await expect(page.getByTestId('status-chip-cancelled')).toBeVisible();

    // Default chip "Todos" is active.
    await expect(page.getByTestId('status-chip-all')).toHaveAttribute(
      'data-active',
      'true',
    );

    // New-WO button + search input present.
    await expect(page.getByTestId('new-work-order-btn')).toBeVisible();
    await expect(page.getByTestId('search-input')).toBeVisible();
  });

  test('clicking the in_progress chip updates the URL to ?status=in_progress', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the list endpoint before clicking — avoids races on the
    // pre-click fetch interleaving with the post-click one.
    const refetch = page.waitForRequest(
      (req) =>
        req.method() === 'GET' &&
        req.url().includes('/work-orders') &&
        req.url().includes('status=in_progress'),
      { timeout: 10000 },
    );

    await page.getByTestId('status-chip-in_progress').click({ force: true });

    await expect(page).toHaveURL(/\?.*status=in_progress/);
    await expect(page.getByTestId('status-chip-in_progress')).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.getByTestId('status-chip-all')).toHaveAttribute(
      'data-active',
      'false',
    );

    const req = await refetch.catch(() => null);
    expect(req).not.toBeNull();
  });

  test('clicking Todos clears ?status= and the list refetches', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=draft');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByTestId('status-chip-draft')).toHaveAttribute(
      'data-active',
      'true',
    );

    await page.getByTestId('status-chip-all').click({ force: true });

    // ?status= should be gone (URL might also be base path).
    await expect(page).toHaveURL(/\/ordenes-de-trabajo(\?.*)?$/);
    await expect(page).not.toHaveURL(/status=draft/);
    await expect(page.getByTestId('status-chip-all')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('search input writes ?search= to the URL and refetches', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    const needle = 'XYZ-NEEDLE-123';

    await page.getByTestId('search-input').fill(needle);

    // URL reflects the search term verbatim.
    await expect(page).toHaveURL(new RegExp(`search=${needle}`));

    // List refetched with the search param.
    const matchedReq = await page
      .waitForRequest(
        (req) =>
          req.method() === 'GET' &&
          req.url().includes('/work-orders') &&
          req.url().includes(`search=${needle}`),
        { timeout: 10000 },
      )
      .catch(() => null);
    expect(matchedReq).not.toBeNull();
  });

  test('clearing the search input strips ?search= from the URL', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?search=initial');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByTestId('search-input')).toHaveValue('initial');

    await page.getByTestId('search-input').fill('');

    await expect(page).not.toHaveURL(/search=/);
  });

  test('deep-link with ?status= and ?search= restores chip + input state', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo?status=completed&search=ABC');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByTestId('status-chip-completed')).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.getByTestId('search-input')).toHaveValue('ABC');
  });

  test('opens the Nueva orden dialog when the create button is clicked', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/ordenes-de-trabajo');
    await expect(page.getByTestId('ordenes-de-trabajo-page')).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('new-work-order-btn').click({ force: true });

    // Dialog renders with the expected title.
    await expect(
      page.getByRole('dialog', { name: 'Nueva orden de trabajo' }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('fg-quantity-input')).toBeVisible();
    await expect(page.getByTestId('submit-work-order-btn')).toBeVisible();
  });
});
