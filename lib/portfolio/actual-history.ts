/**
 * Actual-history attribution series for subjects with dated holdings (13F
 * filers, funds).
 *
 * The series is the subject's reported books held at each report's weights and
 * priced daily: weights change at each report date. Clock: period of report —
 * a book is held from the first close on or after its report date, whenever it
 * was filed. The filing (knowledge) date does not place the book.
 *
 * First reliable date: the first session inside the coverage mask, a
 * two-threshold rule on the share of the book that is priced.
 *
 *   coverage(t)   share of the in-force book's value that is priced on t
 *   enter         coverage(t) >= 0.50   → in the mask
 *   exit          coverage(t) <  0.10   → out of the mask (no book in force → out)
 *   between       state unchanged; the first session is in only on a strong enter
 *
 * Funds: the published fund store already blanks sessions outside the fund
 * coverage mask (linked equity >= 50% of reported net assets to enter, < 10% to
 * exit, measured on books public by each month-end), so a session with a
 * finite return is in the mask and `coverage` reports the priced share of the
 * book. Filers: no published mask exists yet, so the same thresholds are
 * applied here to the session coverage of the 13F book (mapped share of the
 * reported value × priced share of the mapped book).
 *
 * Pure; no I/O.
 */

export const ACTUAL_HISTORY_COVERAGE_ENTER = 0.5;
export const ACTUAL_HISTORY_COVERAGE_EXIT = 0.1;

export type ActualHistorySubject = "fund" | "filer";

/** The report_date-basis daily cube as read from the per-entity store. */
export interface DailyReturnsCube {
  teo: string[];
  gross_return: (number | null)[];
  l1_market: (number | null)[];
  l2_sector: (number | null)[];
  l3_subsector: (number | null)[];
  l3_residual: (number | null)[];
  /** Funds only: the style leg, which the fund store keeps out of l3_residual. */
  style_return: (number | null)[] | null;
  weight_coverage: (number | null)[] | null;
  /** Filers only: mapped share of the book's reported value. */
  mapping_coverage: (number | null)[] | null;
  /** Filers only: report date of the book in force each session. */
  holding_report_date: string[] | null;
}

export interface ActualHistorySeries {
  teo: string[];
  gross: (number | null)[];
  market: (number | null)[];
  sector: (number | null)[];
  subsector: (number | null)[];
  residual: (number | null)[];
  /** Share of the in-force book priced that session (0–1). */
  coverage: (number | null)[];
  /** Report date of the book in force (filers); omitted for funds. */
  book_report_date?: (string | null)[];
}

export interface ActualHistory {
  history_kind: "actual";
  time_basis: "period_of_report";
  frequency: "daily";
  first_reliable_date: string;
  first_reliable_rule: {
    coverage_enter: number;
    coverage_exit: number;
    coverage_measure: string;
    description: string;
  };
  start_date: string;
  end_date: string;
  n_periods: number;
  /** Sessions in the returned window that are outside the mask (null legs). */
  n_gap_periods: number;
  return_identity: "gross = market + sector + subsector + residual";
  series: ActualHistorySeries;
}

export interface ActualHistoryWindow {
  startDate?: string;
  endDate?: string;
}

const COVERAGE_MEASURE: Record<ActualHistorySubject, string> = {
  fund: "linked equity share of reported net assets, on books public by each month-end",
  filer: "mapped share of the 13F book's reported value times the priced share of the mapped book, per session",
};

function finite(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Residual leg: the fund store splits style out of the stock-specific residual. */
function residualAt(cube: DailyReturnsCube, i: number): number | null {
  const l3 = cube.l3_residual[i];
  if (!finite(l3)) return null;
  if (cube.style_return) {
    const s = cube.style_return[i];
    return finite(s) ? s + l3 : null;
  }
  return l3;
}

function coverageAt(subject: ActualHistorySubject, cube: DailyReturnsCube, i: number): number | null {
  const w = cube.weight_coverage?.[i];
  if (subject === "fund") return finite(w) ? w : null;
  const m = cube.mapping_coverage?.[i];
  if (!finite(w) || !finite(m)) return null;
  return m * w;
}

/**
 * Two-threshold membership on a coverage series. NaN/null (no book in force)
 * exits. The first session is a member only on a strong enter.
 */
export function coverageHysteresis(
  coverage: (number | null)[],
  enter = ACTUAL_HISTORY_COVERAGE_ENTER,
  exit = ACTUAL_HISTORY_COVERAGE_EXIT,
): boolean[] {
  const out: boolean[] = new Array(coverage.length);
  let state = false;
  for (let i = 0; i < coverage.length; i++) {
    const c = coverage[i];
    if (!finite(c) || c < exit) state = false;
    else if (c >= enter) state = true;
    out[i] = state;
  }
  return out;
}

/**
 * Build the actual-history series. Returns null when no session is in the
 * mask (the subject has no reliable history). The window trims the output
 * after the first reliable date is set, so the date does not depend on it.
 */
export function buildActualHistory(
  subject: ActualHistorySubject,
  cube: DailyReturnsCube,
  window: ActualHistoryWindow = {},
): ActualHistory | null {
  const n = cube.teo.length;
  const coverage: (number | null)[] = new Array(n);
  const valid: boolean[] = new Array(n);
  const residual: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    coverage[i] = coverageAt(subject, cube, i);
    residual[i] = residualAt(cube, i);
    valid[i] =
      finite(cube.gross_return[i]) &&
      finite(cube.l1_market[i]) &&
      finite(cube.l2_sector[i]) &&
      finite(cube.l3_subsector[i]) &&
      residual[i] !== null;
  }
  // Funds: the store's blanking is the mask. Filers: apply the thresholds here.
  const member = subject === "fund" ? valid.slice() : coverageHysteresis(coverage);

  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (member[i] && valid[i]) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;

  let t0 = first;
  let t1 = last + 1;
  if (window.startDate) while (t0 < t1 && cube.teo[t0]! < window.startDate) t0++;
  if (window.endDate) while (t1 > t0 && cube.teo[t1 - 1]! > window.endDate) t1--;
  if (t0 >= t1) return null;

  const series: ActualHistorySeries = {
    teo: [],
    gross: [],
    market: [],
    sector: [],
    subsector: [],
    residual: [],
    coverage: [],
  };
  if (cube.holding_report_date) series.book_report_date = [];
  let gaps = 0;
  for (let i = t0; i < t1; i++) {
    const keep = member[i] && valid[i];
    if (!keep) gaps++;
    series.teo.push(cube.teo[i]!);
    series.gross.push(keep ? cube.gross_return[i]! : null);
    series.market.push(keep ? cube.l1_market[i]! : null);
    series.sector.push(keep ? cube.l2_sector[i]! : null);
    series.subsector.push(keep ? cube.l3_subsector[i]! : null);
    series.residual.push(keep ? residual[i] : null);
    series.coverage.push(coverage[i] ?? null);
    if (series.book_report_date) {
      const d = cube.holding_report_date![i];
      series.book_report_date.push(d ? d : null);
    }
  }

  const enterPct = Math.round(ACTUAL_HISTORY_COVERAGE_ENTER * 100);
  const exitPct = Math.round(ACTUAL_HISTORY_COVERAGE_EXIT * 100);
  return {
    history_kind: "actual",
    time_basis: "period_of_report",
    frequency: "daily",
    first_reliable_date: cube.teo[first]!,
    first_reliable_rule: {
      coverage_enter: ACTUAL_HISTORY_COVERAGE_ENTER,
      coverage_exit: ACTUAL_HISTORY_COVERAGE_EXIT,
      coverage_measure: COVERAGE_MEASURE[subject],
      description:
        `First session whose reported book has at least ${enterPct}% of its weight covered; ` +
        `sessions after it are dropped while coverage is below ${exitPct}% and return once it is back to ${enterPct}%.`,
    },
    start_date: series.teo[0]!,
    end_date: series.teo[series.teo.length - 1]!,
    n_periods: series.teo.length,
    n_gap_periods: gaps,
    return_identity: "gross = market + sector + subsector + residual",
    series,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `start_date` / `end_date` query params; an error string when invalid. */
export function parseActualHistoryWindow(
  params: URLSearchParams,
): { ok: true; window: ActualHistoryWindow } | { ok: false; error: string } {
  const startDate = params.get("start_date") ?? undefined;
  const endDate = params.get("end_date") ?? undefined;
  if (startDate && !ISO_DATE.test(startDate)) return { ok: false, error: "start_date must be YYYY-MM-DD" };
  if (endDate && !ISO_DATE.test(endDate)) return { ok: false, error: "end_date must be YYYY-MM-DD" };
  if (startDate && endDate && startDate > endDate) {
    return { ok: false, error: "start_date must be <= end_date" };
  }
  return { ok: true, window: { startDate, endDate } };
}
