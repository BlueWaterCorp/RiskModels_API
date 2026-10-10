/**
 * Long-short guard for the F1 fund snapshot (JSON + PDF).
 *
 * The F1 composition normalises holdings by `aum_erm3`, the NET (long + short)
 * equity value of the book, and `fund_holdings_top` carries longs only. For a
 * fund with a material short book that misstates every number on the page:
 * VMNFX (97% long / 92% short of net assets at its 2026-06-30 N-PORT filing)
 * renders a $27M AUM against $597M of net assets and ~20% weights per name.
 * Until a long-short layout exists on this route, the snapshot refuses such
 * funds instead of rendering them.
 *
 * Quantities at the latest filed column of the fund's ds_ph.zarr:
 *   L = sum of adj_mv > 0, S = sum of adj_mv < 0 (USD, S <= 0),
 *   NAV = aum_reported when aum_source == 1 (N-PORT NET_ASSETS header).
 * Rules (any one refuses):
 *   R1  -S / NAV >= 0.05                               short leg material
 *   R2  (L + S) / NAV < 0.50 and -S / NAV >= 0.01       small net book, hedged
 *   R3  NAV unknown and -S / (L - S) >= 0.05            filings without NET_ASSETS:
 *       the short leg against gross. With aum_source != 1, aum_reported is the
 *       sum of adj_mv, i.e. the net of a long-short book, and is never used as NAV.
 *
 * Same thresholds and rules as BWMACRO `bwmacro/snapshots/funds/_ls_guard.py`
 * (the Python F1 and the bulk renderer). Calibration over 12,144 active funds
 * (2026-10-10): R1 catches 168, R2 adds 27, R3 catches 6. Net < 50% of NAV
 * without shorts (3,459 international, bond and allocation funds) is not
 * refused by this guard.
 */

export const LS_SHORT_NAV_MIN = 0.05;
export const LS_NET_NAV_MAX = 0.5;
export const LS_NET_RULE_SHORT_FLOOR = 0.01;

export const LONG_SHORT_UNAVAILABLE_MESSAGE = "long-short fund: sheet not available";
export const LONG_SHORT_UNAVAILABLE_CODE = "long_short_sheet_unavailable";

export interface FundBookShape {
  /** ISO date of the filed column the totals come from. */
  teo: string;
  long_mv: number;
  /** Negative or zero. */
  short_mv: number;
  /** N-PORT NET_ASSETS at that column; null when the filing has no header. */
  nav: number | null;
  n_long: number;
  n_short: number;
}

export interface LongShortVerdict {
  refuse: boolean;
  rule: "R1" | "R2" | "R3" | null;
  reason: string;
  long_nav: number | null;
  short_nav: number | null;
  net_nav: number | null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function classifyFundBook(b: FundBookShape): LongShortVerdict {
  if (b.nav != null && b.nav > 0) {
    const longNav = b.long_mv / b.nav;
    const shortNav = -b.short_mv / b.nav;
    const netNav = (b.long_mv + b.short_mv) / b.nav;
    const base = { long_nav: longNav, short_nav: shortNav, net_nav: netNav };
    if (shortNav >= LS_SHORT_NAV_MIN) {
      return {
        ...base,
        refuse: true,
        rule: "R1",
        reason: `short leg ${pct(shortNav)} of net assets >= ${pct(LS_SHORT_NAV_MIN)}`,
      };
    }
    if (netNav < LS_NET_NAV_MAX && shortNav >= LS_NET_RULE_SHORT_FLOOR) {
      return {
        ...base,
        refuse: true,
        rule: "R2",
        reason: `net equity book ${pct(netNav)} of net assets < ${pct(LS_NET_NAV_MAX)} with short leg ${pct(shortNav)}`,
      };
    }
    return { ...base, refuse: false, rule: null, reason: `short ${pct(shortNav)}, net ${pct(netNav)} of net assets` };
  }
  const gross = b.long_mv - b.short_mv;
  const shortGross = gross > 0 ? -b.short_mv / gross : null;
  const none = { long_nav: null, short_nav: null, net_nav: null };
  if (shortGross != null && shortGross >= LS_SHORT_NAV_MIN) {
    return {
      ...none,
      refuse: true,
      rule: "R3",
      reason: `no NET_ASSETS header; short leg ${pct(shortGross)} of gross >= ${pct(LS_SHORT_NAV_MIN)}`,
    };
  }
  return { ...none, refuse: false, rule: null, reason: "no NET_ASSETS header; short leg immaterial or absent" };
}

/**
 * Index of the latest filed column: the newest teo whose `aum_erm3` is finite
 * and non-zero (months after a filing are forward fills, not filings). A
 * negative net (QMNNX) still counts; the F1 reader's `aum_erm3 > 0` filter
 * would skip it and fall back to an older column. -1 when none.
 */
export function latestFiledColumn(aumErm3: (number | null)[]): number {
  for (let i = aumErm3.length - 1; i >= 0; i--) {
    const a = aumErm3[i];
    if (a != null && Number.isFinite(a) && a !== 0) return i;
  }
  return -1;
}

export function totalBookColumn(
  teo: string,
  adjMv: (number | null)[],
  aumReported: number | null,
  aumSource: number | null,
): FundBookShape {
  let L = 0;
  let S = 0;
  let nL = 0;
  let nS = 0;
  for (const v of adjMv) {
    if (v == null || !Number.isFinite(v) || v === 0) continue;
    if (v > 0) {
      L += v;
      nL++;
    } else {
      S += v;
      nS++;
    }
  }
  const nav =
    aumSource === 1 && aumReported != null && Number.isFinite(aumReported) && aumReported > 0
      ? aumReported
      : null;
  return { teo, long_mv: L, short_mv: S, nav, n_long: nL, n_short: nS };
}
