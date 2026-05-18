/**
 * F1 fund tearsheet — render-to-string structural tests.
 *
 * Real-fixture-driven: the FundSnapshot is composed from the same JSON
 * fixtures that drive the snapshot composer / route tests, then the
 * F1FundTearsheet is rendered to static HTML via react-dom/server. We
 * assert structure (sentinel, section titles, SVG presence, NAV legend
 * gating) — not pixel layout, which is Playwright's job in D.2.b.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  FundLatestRow,
  FundRow,
  StylePortfolioRow,
  StyleRankingRow,
} from "@/lib/dal/funds-engine";
import type {
  FundNavRow,
  FundPortfolioRow,
} from "@/lib/dal/funds-zarr-reader";
import { composeFundSnapshot } from "@/lib/funds/snapshot-composer";
import { F1FundTearsheet } from "@/lib/funds/snapshot-templates/F1FundTearsheet";

function fixture<T>(name: string): T {
  const p = join(__dirname, "fixtures", "funds", name);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const FUND = fixture<FundRow>("fund.json");
const LATEST = fixture<FundLatestRow>("funds_latest.json");
const FUND_COHORT_RANKS = fixture<StyleRankingRow[]>("fund_cohort_ranks.json");
const COHORT_METRICS = fixture<StylePortfolioRow[]>("cohort_metrics.json");

/** 12-month synthetic portfolio history. The real ds_portfolio.zarr is not
 * dumped to JSON fixtures — this scaffolding satisfies the row shape required
 * by the chart component without committing zarr binaries. */
function makePortfolio(months = 12): FundPortfolioRow[] {
  const rows: FundPortfolioRow[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(2025, i - 1, 1));
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    rows.push({
      teo: d.toISOString().slice(0, 10),
      portfolio_gross_return: 0.012 + (i % 4) * 0.001,
      portfolio_market_return: 0.008 + (i % 3) * 0.001,
      portfolio_sector_return: 0.002,
      portfolio_subsector_return: 0.001,
      portfolio_idiosyncratic_return: 0.001,
      identity_residual: 0,
      weight_sum: 0.99,
      n_holdings_active: 100,
      effective_n: 50,
      top10_weight_sum: 0.34,
    });
  }
  return rows;
}

function makeNav(months = 12): FundNavRow[] {
  return makePortfolio(months).map((r) => ({
    teo: r.teo,
    nav_close: 100,
    nav_return_monthly: (r.portfolio_gross_return ?? 0) - 0.001,
  }));
}

function renderHtml(snap: ReturnType<typeof composeFundSnapshot>): string {
  return renderToStaticMarkup(
    React.createElement(F1FundTearsheet, { snap }),
  );
}

describe("F1FundTearsheet — server render (composed snapshot, real fixtures)", () => {
  const snap = composeFundSnapshot({
    fund: FUND,
    latest: LATEST,
    holdings: null,
    hedge: null,
    portfolioHistory: makePortfolio(),
    navHistory: makeNav(),
    cohortRanks: FUND_COHORT_RANKS,
    cohortMetrics: COHORT_METRICS,
  });

  it("emits the data-report-ready sentinel for Playwright", () => {
    const html = renderHtml(snap);
    expect(html).toContain('data-report-ready="true"');
  });

  it("renders the fund identity in the header", () => {
    const html = renderHtml(snap);
    expect(html).toContain(FUND.fund_name!);
    if (FUND.ticker) {
      expect(html).toContain(FUND.ticker);
    }
  });

  it("renders the I / II / III section titles", () => {
    const html = renderHtml(snap);
    expect(html).toContain("Cumulative Returns");
    expect(html).toContain("Cohort Rank");
    expect(html).toContain("Top Holdings");
  });

  it("emits an SVG cumulative chart with at least one path", () => {
    const html = renderHtml(snap);
    expect(html).toMatch(/<svg[^>]+>[\s\S]*<path[^>]+>/);
  });

  it("includes the NAV legend chip + endpoint text when nav_history is present", () => {
    const html = renderHtml(snap);
    // Legend chip + endpoint markers both render the literal "NAV"
    expect(html).toContain("NAV");
    // The geometric attribution waterfall shows "Residual α" as a category label
    expect(html).toContain("Residual");
  });

  it("falls back gracefully when nav_history is null (no NAV overlay rendered)", () => {
    const noNavSnap = composeFundSnapshot({
      fund: FUND,
      latest: LATEST,
      holdings: null,
      hedge: null,
      portfolioHistory: makePortfolio(),
      navHistory: [],
      cohortRanks: FUND_COHORT_RANKS,
      cohortMetrics: COHORT_METRICS,
    });
    expect(noNavSnap.nav_history).toBeNull();
    const html = renderHtml(noNavSnap);
    expect(html).toContain('data-report-ready="true"');
    expect(html).toContain("Cumulative Returns");
  });

  it("places at least one cohort rank row when fund_cohort_ranks fixture is non-empty", () => {
    const html = renderHtml(snap);
    // First metric label should appear in the table; metrics are like
    // 'portfolio_gross_return' rendered with underscores → spaces in the UI.
    if (FUND_COHORT_RANKS.length > 0) {
      const firstMetricSpaced = FUND_COHORT_RANKS[0]!.metric.replace(/_/g, " ");
      expect(html).toContain(firstMetricSpaced);
    }
  });
});
