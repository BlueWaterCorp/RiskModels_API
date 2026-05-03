import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  composeFundSnapshot,
  composeCohortSnapshot,
  type CohortSnapshotPrimitives,
  type FundSnapshotPrimitives,
} from "@/lib/funds/snapshot-composer";
import type {
  FundLatestRow,
  FundRow,
  StylePortfolioRow,
  StyleRankingRow,
} from "@/lib/dal/funds-engine";

// All fixture rows are slices of real post-Slice-11-sync data from the
// Funds_DAG repo's `data/sync/funds/*.json` dumps (byte-identical to what
// landed in remote Supabase). Keeping fixtures in-repo means tests run
// without a sibling-repo dependency.
function fixture<T>(name: string): T {
  const p = join(__dirname, "fixtures", "funds", name);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const FUND = fixture<FundRow>("fund.json");
const LATEST = fixture<FundLatestRow>("funds_latest.json");
const FUND_COHORT_RANKS = fixture<StyleRankingRow[]>("fund_cohort_ranks.json");
const COHORT_METRICS = fixture<StylePortfolioRow[]>("cohort_metrics.json");
const COHORT_TOP_SYMBOLS = fixture<StyleRankingRow[]>("cohort_top_symbols.json");
const COHORT_TOP_FUNDS = fixture<StyleRankingRow[]>("cohort_top_funds.json");

describe("composeFundSnapshot (real fixtures: NOLCX / Northern Large Cap Core)", () => {
  const basePrimitives: FundSnapshotPrimitives = {
    fund: FUND,
    latest: LATEST,
    holdings: null,
    hedge: null,
    portfolioHistory: [],
    navHistory: [],
    cohortRanks: FUND_COHORT_RANKS,
    cohortMetrics: COHORT_METRICS,
  };

  it("preserves the fund identity + bitemporal triple from the registry", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.bw_fund_id).toBe("BW-FUND-S000001243");
    expect(snap.ticker).toBe("NOLCX");
    expect(snap.equity_style_9box).toBe("Large Blend");
    expect(snap.report_date).toBe(LATEST.report_date);
    expect(snap.filing_date).toBe(LATEST.filing_date);
  });

  it("nests latest metrics via formatFundMetrics", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.metrics.bw_fund_id).toBe("BW-FUND-S000001243");
    expect(snap.metrics.returns.gross).toBe(LATEST.portfolio_gross_return);
    expect(snap.metrics.diagnostics.effective_n).toBe(LATEST.effective_n);
  });

  it("emits one cohort_context.ranks entry per fixture rank row, preserving rank/cohort_size", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.cohort_context).not.toBeNull();
    expect(snap.cohort_context!.ranks).toHaveLength(FUND_COHORT_RANKS.length);
    // Spot-check: every entry carries the n / n_group shape the user asked for.
    for (const r of snap.cohort_context!.ranks) {
      expect(typeof r.rank).toBe("number");
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(typeof r.metric).toBe("string");
      expect(typeof r.period_window).toBe("string");
    }
  });

  it("uses cohort cell name + n_funds_in_cell from cohortMetrics when present", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.cohort_context!.equity_style_9box).toBe("Large Blend");
    // n_funds_in_cell may be null in fixtures; if so just verify it's a number-or-null.
    const n = snap.cohort_context!.n_funds_in_cell;
    expect(n == null || typeof n === "number").toBe(true);
  });

  it("returns cohort_context = null when fund has no equity_style_9box", () => {
    const fundUnclassified: FundRow = { ...FUND, equity_style_9box: null };
    const snap = composeFundSnapshot({ ...basePrimitives, fund: fundUnclassified });
    expect(snap.cohort_context).toBeNull();
  });

  it("portfolio_history is empty + lookback_months=12 when no history available", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.portfolio_history.lookback_months).toBe(12);
    expect(snap.portfolio_history.n_periods).toBe(0);
    expect(snap.portfolio_history.rows).toEqual([]);
  });

  it("trims portfolio_history to the trailing 12 months when more is provided", () => {
    // Construct a chronologically-ordered fake series spanning 18 months.
    // (Acceptable scaffolding per memory note: testing wiring/transparency, not
    // values; real ds_portfolio.zarr time series isn't materialized to JSON dumps.)
    const teos: string[] = [];
    for (let m = 1; m <= 18; m++) {
      const d = new Date(Date.UTC(2025, m - 1, 1));
      // Last day of month
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      teos.push(d.toISOString().slice(0, 10));
    }
    const synthetic = teos.map((teo) => ({
      teo,
      portfolio_gross_return: 0,
      portfolio_market_return: 0,
      portfolio_sector_return: 0,
      portfolio_subsector_return: 0,
      portfolio_idiosyncratic_return: 0,
      identity_residual: 0,
      weight_sum: 1,
      n_holdings_active: 100,
      effective_n: 50,
      top10_weight_sum: 0.3,
    }));
    const snap = composeFundSnapshot({ ...basePrimitives, portfolioHistory: synthetic });
    expect(snap.portfolio_history.n_periods).toBe(12);
    expect(snap.portfolio_history.rows[0].teo).toBe(teos[6]);
    expect(snap.portfolio_history.rows[11].teo).toBe(teos[17]);
  });

  it("nav_history is null when navHistory is empty (fund has no yfinance ticker / zarr)", () => {
    const snap = composeFundSnapshot(basePrimitives);
    expect(snap.nav_history).toBeNull();
  });

  it("populates nav_history with the rows + lookback_months when navHistory is provided", () => {
    const navRows = [
      { teo: "2026-03-31", nav_close: 32.5, nav_return_monthly: 0.012 },
      { teo: "2026-04-30", nav_close: 33.16, nav_return_monthly: 0.0203 },
    ];
    const snap = composeFundSnapshot({ ...basePrimitives, navHistory: navRows });
    expect(snap.nav_history).not.toBeNull();
    expect(snap.nav_history!.lookback_months).toBe(12);
    expect(snap.nav_history!.n_periods).toBe(2);
    expect(snap.nav_history!.rows).toEqual(navRows);
  });

  it("trims nav_history to the trailing 12 months when more is provided", () => {
    const teos: string[] = [];
    for (let m = 1; m <= 18; m++) {
      const d = new Date(Date.UTC(2025, m - 1, 1));
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      teos.push(d.toISOString().slice(0, 10));
    }
    const synthetic = teos.map((teo) => ({
      teo,
      nav_close: 100,
      nav_return_monthly: 0.01,
    }));
    const snap = composeFundSnapshot({ ...basePrimitives, navHistory: synthetic });
    expect(snap.nav_history!.n_periods).toBe(12);
    expect(snap.nav_history!.rows[0].teo).toBe(teos[6]);
    expect(snap.nav_history!.rows[11].teo).toBe(teos[17]);
  });
});

describe("composeCohortSnapshot (real fixtures: Large Blend cell)", () => {
  const basePrimitives: CohortSnapshotPrimitives = {
    cellName: "Large Blend",
    slug: "large-blend",
    cohortMetrics: COHORT_METRICS,
    topFunds: COHORT_TOP_FUNDS,
    topSymbols: COHORT_TOP_SYMBOLS,
    portfolioHistory: [],
    cohortHoldings: null,
  };

  it("returns null when cohortMetrics is empty", () => {
    expect(
      composeCohortSnapshot({ ...basePrimitives, cohortMetrics: [] }),
    ).toBeNull();
  });

  it("packs cohortMetrics into a per-weighting block (ew + mv side-by-side)", () => {
    const snap = composeCohortSnapshot(basePrimitives);
    expect(snap).not.toBeNull();
    const weightings = snap!.metrics.weightings as Record<string, unknown>;
    expect(Object.keys(weightings).sort()).toEqual(["ew", "mv"]);
  });

  it("forwards top_funds with metric + period_window + rows preserved", () => {
    const snap = composeCohortSnapshot(basePrimitives);
    expect(snap!.top_funds).not.toBeNull();
    expect(snap!.top_funds!.rows).toHaveLength(COHORT_TOP_FUNDS.length);
    // Every fixture row is the cohort_type='fund' subset, so weighting='ew' (placeholder).
    expect(snap!.top_funds!.weighting).toBe("ew");
  });

  it("forwards top_symbols with the chosen metric/window/weighting", () => {
    const snap = composeCohortSnapshot(basePrimitives);
    expect(snap!.top_symbols).not.toBeNull();
    expect(snap!.top_symbols!.rows).toHaveLength(COHORT_TOP_SYMBOLS.length);
    expect(snap!.top_symbols!.weighting).toBe("mv");
    expect(snap!.top_symbols!.metric).toBe("weight");
  });

  it("uses the freshest report_date / filing_date_max across weightings", () => {
    const snap = composeCohortSnapshot(basePrimitives);
    const maxReport = COHORT_METRICS.reduce(
      (acc, m) => (m.report_date > acc ? m.report_date : acc),
      COHORT_METRICS[0]!.report_date,
    );
    expect(snap!.report_date).toBe(maxReport);
  });

  it("includes lineage in _metadata", () => {
    const snap = composeCohortSnapshot(basePrimitives);
    expect(snap!._metadata.data_as_of).toBe(snap!.report_date);
    expect(typeof snap!._metadata.data_freshness).toBe("string");
  });
});
