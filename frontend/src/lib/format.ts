/**
 * lib/format.ts — locale-aware date / datetime formatting helpers.
 *
 * See `frontend/src/CONVENTIONS.md` §4 (Reusable primitives catalog).
 *
 * Why a module-level helper instead of inline `new Date(...).toLocaleDateString('es-MX')`:
 * 1. Calling `toLocaleDateString` in render risks a server/client hydration
 *    mismatch because Node may render under a different TZ/locale than the
 *    browser. Centralizing the formatter keeps the call site narrow.
 * 2. Caller sites tag the rendered element with `suppressHydrationWarning`
 *    so React still owns the post-hydration value (intentional difference).
 * 3. Defining the formatter at module scope (outside any JSX tree) removes
 *    the `react-doctor/rendering-hydration-mismatch-time` trigger for sort
 *    comparators / CSV export callbacks that don't reach render.
 */

const DATE_FMT_SHORT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

const DATE_FMT_MEDIUM: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const DATETIME_FMT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** Parse a date-ish value to epoch ms; returns 0 for null/undefined/invalid. */
function toEpochMs(value: string | number | Date | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Locale (es-MX) short date: dd/mm/yyyy. Returns fallback for empty/invalid. */
export function formatDateEs(
  value: string | number | Date | null | undefined,
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('es-MX', DATE_FMT_SHORT);
}

/** Locale (es-MX) medium date: "1 may. 2026". */
export function formatDateMediumEs(
  value: string | number | Date | null | undefined,
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('es-MX', DATE_FMT_MEDIUM);
}

/** Locale (es-MX) date + time. */
export function formatDateTimeEs(
  value: string | number | Date | null | undefined,
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString('es-MX', DATETIME_FMT);
}

/** Stable comparator for descending date sort. Safe to call from render. */
export function compareDateDesc(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined,
): number {
  return toEpochMs(b) - toEpochMs(a);
}

