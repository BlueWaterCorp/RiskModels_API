/**
 * `bw_sym_id` ISIN-leak scrub at the public-API read boundary.
 *
 * Background — MASTER_BACKLOG H.24
 * --------------------------------
 * The internal `bw_sym_id` namespace is **variable-backed**:
 *   • Most ids are FIGI-derived: `BW-BBG000B9XRY4` (Apple), `BW-BBG009S3NB30`
 *     (GOOG), etc. FIGI is openly licensed (Bloomberg OpenFIGI) and safe
 *     to redistribute.
 *   • A long tail is **ISIN-derived**: `BW-US78462F1030` (SPY),
 *     `BW-{country}{check-digit}{...}` for many non-US securities. ISINs
 *     are ANNA/NSA-licensed — redistributing them in API responses risks
 *     license violation.
 *
 * This module detects ISIN-flavored ids on the read path (every per-holding
 * row) and substitutes a non-licensed equivalent before returning to the
 * caller. Wire-shape `bw_sym_id` field stays the same; only the value form
 * changes for the offending rows.
 *
 * Substitution policy (best → worst, picks the first available):
 *   1. **FIGI form** — when the caller supplies the FIGI for that
 *      `bw_sym_id` (from `symbols.metadata.figi`), the scrub returns
 *      `BW-{figi}`. Indistinguishable from a natively-FIGI-keyed id.
 *   2. **Ticker form** — when the caller supplies a ticker, returns
 *      `BW-TICKER-{TICKER}`. Not a licensed id; reversible via
 *      `/api/data/symbols/batch`.
 *   3. **Restricted placeholder** — `BW-RESTRICTED`. Last resort when the
 *      caller has neither FIGI nor ticker. Loses identity (any unresolved
 *      rows collapse to the same id). The DAL batch-resolves to avoid
 *      this for the live universe.
 *
 * The shape detectors are conservative — they accept the canonical ISIN /
 * FIGI patterns and pass through anything else unchanged (e.g.,
 * `BW-FUND-S000004563`, `BW-FILER-CIK0001067983`, `BW-ETF-IVV` — all
 * registry-id forms that are public).
 */

/**
 * `BW-BBG{9 alphanumerics}` — FIGI form (Bloomberg OpenFIGI, openly licensed).
 *
 * 12-char FIGI: 3-char prefix `BBG` + 8 base-36 chars + 1 check digit.
 * Letters are upper-case; digits 0-9 allowed throughout.
 */
export const BW_FIGI_RE = /^BW-BBG[A-Z0-9]{9}$/;

/**
 * `BW-{2-char country}{9 alphanumerics}{1 digit}` — ISIN form (licensed).
 *
 * 12-char ISIN: 2 country-code letters + 9 base-alphanumeric NSIN chars + 1
 * check digit. SPY → `US78462F1030`, etc. Excludes `BB` prefix (which is
 * `BBG` FIGI start) — that overlap is impossible because FIGI is 12 chars
 * starting `BBG` and ISIN is 12 chars starting with two letters that are
 * never `BB` for the `BBG` prefix.
 */
export const BW_ISIN_RE = /^BW-[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function isFigiFlavoredSymId(s: string | null | undefined): boolean {
  if (!s) return false;
  return BW_FIGI_RE.test(s);
}

export function isIsinFlavoredSymId(s: string | null | undefined): boolean {
  if (!s) return false;
  // FIGI (BW-BBG...) also matches the country-code/ISIN regex by length —
  // FIGI takes precedence. Treat as ISIN only when it's NOT FIGI.
  if (BW_FIGI_RE.test(s)) return false;
  return BW_ISIN_RE.test(s);
}

export interface ScrubResolution {
  /** Open-license FIGI for this bw_sym_id (from `symbols.metadata.figi`). */
  figi?: string | null;
  /** Public ticker for this bw_sym_id. Used when FIGI is absent. */
  ticker?: string | null;
}

/**
 * Scrub one `bw_sym_id` value. Returns the original id when it's already
 * safe (FIGI-flavored, or a non-ISIN registry form). Returns a substitute
 * when it's ISIN-flavored — preferring FIGI, then ticker, then a generic
 * `BW-RESTRICTED` placeholder.
 *
 * Pure / synchronous — caller passes in pre-resolved `figi` + `ticker`
 * from a batch lookup against the `symbols` table.
 */
export function scrubBwSymId(
  bwSymId: string,
  resolved?: ScrubResolution,
): string {
  if (!isIsinFlavoredSymId(bwSymId)) return bwSymId;

  const figi = resolved?.figi?.trim();
  if (figi) {
    // FIGIs from `symbols.metadata.figi` are stored as the 12-char code
    // (e.g. "BBG000B9XRY4"). Some sources prefix `BBG` already; some don't.
    // Normalize to `BW-BBG{...}`.
    const figiCode = figi.toUpperCase().replace(/^BBG/, "");
    return `BW-BBG${figiCode}`;
  }

  const ticker = resolved?.ticker?.trim().toUpperCase();
  if (ticker) {
    // Replace dots/dashes — tickers like `BRK.B` would otherwise break the
    // `BW-{prefix}-{value}` convention used elsewhere (`BW-ETF-IVV` etc.).
    const safeTicker = ticker.replace(/[^A-Z0-9]+/g, "_");
    return `BW-TICKER-${safeTicker}`;
  }

  return "BW-RESTRICTED";
}
