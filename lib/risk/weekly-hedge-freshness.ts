/**
 * Freshness rules for the weekly pre-market hedge snapshot.
 *
 * These live outside app/api/weekly-hedge/route.ts on purpose: a Next.js App
 * Router route module may only export the framework's own names (GET, OPTIONS,
 * runtime, dynamic, ...), so exporting helpers from it fails `next build` —
 * which `tsc --noEmit` does not catch.
 */

/**
 * Next session after `computedThrough`, in UTC, as YYYY-MM-DD.
 * Weekend-aware only: the snapshot is always built from a Friday close for the
 * following Monday, so a calendar roll is enough to detect a stale week.
 */
export function expectedEffectiveFrom(computedThrough: string): string | null {
  const ct = new Date(`${computedThrough}T00:00:00Z`);
  if (Number.isNaN(ct.getTime())) return null;
  const next = new Date(ct.getTime() + 86400000);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString().slice(0, 10);
}

/**
 * A snapshot is stale once the week it is effective for has passed.
 *
 * Serving it anyway is the failure that costs money: last week's hedge ratios
 * are indistinguishable from this week's to a caller that does not check —
 * same names, same shape, same columns.
 *
 * A missing or unparseable effective_from reads as STALE. The dangerous
 * default would be the other way.
 */
export function isStale(effectiveFrom: string | null, now: Date): boolean {
  if (!effectiveFrom) return true;
  const eff = new Date(`${effectiveFrom}T00:00:00Z`);
  if (Number.isNaN(eff.getTime())) return true;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Effective for a week: valid from its Monday through the following weekend.
  return today.getTime() > eff.getTime() + 5 * 86400000;
}
