import { describe, expect, it, vi } from "vitest";

/**
 * Selection vs drift (H.146 §D2).
 *
 * The property that has to hold is the identity: selection + drift equals the
 * book's residual return exactly, for any weights, including shorts and a book
 * that is net flat. If that ever stops being true the decomposition has become
 * a fitted attribution, which is a different and much weaker claim.
 *
 * Fixtures use two trading days and hand-checkable numbers so the arithmetic
 * can be verified by reading, not just by running.
 */

const SYMBOLS = new Map([
  ["AAA", { symbol: "BW-BBG000000AAA", ticker: "AAA", sector_etf: "XLK" }],
  ["BBB", { symbol: "BW-BBG000000BBB", ticker: "BBB", sector_etf: "XLK" }],
  ["CCC", { symbol: "BW-BBG000000CCC", ticker: "CCC", sector_etf: "XLE" }],
]);

/** Stock sector-level residuals (l2_rr) by symbol and day. */
const EPS: Record<string, Record<string, number>> = {
  "BW-BBG000000AAA": { "2026-07-30": 0.010, "2026-07-31": -0.004 },
  "BW-BBG000000BBB": { "2026-07-30": 0.002, "2026-07-31": 0.006 },
  "BW-BBG000000CCC": { "2026-07-30": -0.008, "2026-07-31": 0.012 },
};

/** Cohort mean residuals for the same days. */
const MU: Record<string, Record<string, number>> = {
  XLK: { "2026-07-30": 0.003, "2026-07-31": 0.001 },
  XLE: { "2026-07-30": -0.005, "2026-07-31": 0.007 },
};

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolsByTickers: vi.fn(async (tickers: string[]) => {
    const m = new Map();
    for (const t of tickers) {
      const row = SYMBOLS.get(t);
      if (row) m.set(t, row);
    }
    return m;
  }),
}));

vi.mock("@/lib/dal/zarr-reader", () => ({
  readHistorySlice: vi.fn(async ({ symbols }: { symbols: string[] }) => ({
    rows: symbols.flatMap((s) =>
      Object.entries(EPS[s] ?? {}).map(([teo, v]) => ({
        symbol: s,
        teo,
        periodicity: "daily",
        metric_key: "l2_rr",
        metric_value: v,
      })),
    ),
    range: ["2026-07-30", "2026-07-31"] as [string, string],
  })),
}));

vi.mock("@/lib/dal/cohort-zarr-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dal/cohort-zarr-reader")>()),
  readCohortSeries: vi.fn(async ({ tickers }: { tickers: string[] }) =>
    tickers.map((t) => ({
      ticker: t,
      level: 2,
      parent: "SPY",
      points: Object.entries(MU[t] ?? {}).map(([date, v]) => ({
        date,
        values: { residual_mean: v },
      })),
      proxied_fraction: 0,
    })),
  ),
  readCohortStoreMeta: vi.fn(async () => ({
    no_intercept_contract: "ERM3 residuals are estimated WITHOUT an intercept.",
    build_timestamp: "2026-08-03T12:04:21",
  })),
}));

import { getCohortPnlService } from "@/lib/risk/cohort-pnl-service";

const BOOK = [
  { ticker: "AAA", weight: 0.5 },
  { ticker: "BBB", weight: -0.3 },
  { ticker: "CCC", weight: 0.2 },
];

/** Σ w·ε over both days, computed independently of any cohort math. */
function directResidual(book: { ticker: string; weight: number }[]): number {
  let total = 0;
  for (const p of book) {
    const sym = SYMBOLS.get(p.ticker)?.symbol;
    if (!sym) continue;
    for (const v of Object.values(EPS[sym] ?? {})) total += p.weight * v;
  }
  return total;
}

describe("selection vs drift", () => {
  it("splits the book into two parts that sum to the whole", async () => {
    const r = await getCohortPnlService().decompose(BOOK, { level: "sector" });
    expect(r!.totals.selection + r!.totals.drift).toBeCloseTo(r!.totals.residual, 12);
    expect(r!.totals.residual).toBeCloseTo(directResidual(BOOK), 12);
  });

  it("accrues drift on net cohort weight, not gross", async () => {
    const r = await getCohortPnlService().decompose(BOOK, { level: "sector" });
    const xlk = r!.by_cohort.find((c) => c.cohort === "XLK")!;
    // AAA +0.5 and BBB -0.3 are both XLK → net +0.2.
    expect(xlk.net_weight).toBeCloseTo(0.2, 12);
    expect(xlk.n_positions).toBe(2);
    // Drift = net weight × Σ cohort means = 0.2 × (0.003 + 0.001).
    expect(xlk.drift).toBeCloseTo(0.2 * 0.004, 12);
  });

  it("earns no drift on a cohort-neutral book, but still scores selection", async () => {
    // +0.4 and -0.4 within XLK: net zero, so there is no exposure to the
    // cohort's average — every cent of P&L here is selection.
    const neutral = [
      { ticker: "AAA", weight: 0.4 },
      { ticker: "BBB", weight: -0.4 },
    ];
    const r = await getCohortPnlService().decompose(neutral, { level: "sector" });
    expect(r!.totals.drift).toBeCloseTo(0, 12);
    expect(r!.totals.selection).toBeCloseTo(r!.totals.residual, 12);
    expect(r!.totals.selection).not.toBeCloseTo(0, 6);
    expect(r!.totals.selection_share).toBeCloseTo(1, 12);
  });

  it("attributes a pure index-like book almost entirely to drift", async () => {
    // A book holding both XLK names at equal weight tracks the cohort closely,
    // so its P&L should be dominated by the cohort mean rather than by picking.
    const r = await getCohortPnlService().decompose(
      [
        { ticker: "AAA", weight: 0.5 },
        { ticker: "BBB", weight: 0.5 },
      ],
      { level: "sector" },
    );
    expect(Math.abs(r!.totals.drift)).toBeGreaterThan(Math.abs(r!.totals.selection));
  });

  it("keeps the identity when the book is net flat overall", async () => {
    const flat = [
      { ticker: "AAA", weight: 0.5 },
      { ticker: "CCC", weight: -0.5 },
    ];
    const r = await getCohortPnlService().decompose(flat, { level: "sector" });
    expect(r!.net_weight).toBeCloseTo(0, 12);
    expect(r!.totals.selection + r!.totals.drift).toBeCloseTo(r!.totals.residual, 12);
    expect(r!.totals.residual).toBeCloseTo(directResidual(flat), 12);
  });

  it("names what it dropped instead of quietly shrinking the book", async () => {
    const r = await getCohortPnlService().decompose(
      [...BOOK, { ticker: "ZZZ", weight: 9.9 }],
      { level: "sector" },
    );
    expect(r!.coverage.requested).toBe(4);
    expect(r!.coverage.included).toBe(3);
    expect(r!.coverage.dropped).toEqual([
      { ticker: "ZZZ", reason: "ticker not found" },
    ]);
    // The dropped name must not have leaked into the totals.
    expect(r!.totals.residual).toBeCloseTo(directResidual(BOOK), 12);
  });

  it("returns an empty, honest result rather than throwing on a fully unresolvable book", async () => {
    const r = await getCohortPnlService().decompose([{ ticker: "ZZZ", weight: 1 }]);
    expect(r!.coverage.included).toBe(0);
    expect(r!.totals.selection_share).toBeNull();
    expect(r!.series).toEqual([]);
  });

  it("carries the no-intercept contract and a not-advice statement", async () => {
    const r = await getCohortPnlService().decompose(BOOK);
    expect(r!.disclosures.no_intercept_contract).toContain("WITHOUT an intercept");
    expect(r!.disclosures.not_advice).toContain("Not a forecast");
    expect(r!.disclosures.constant_weights).toContain("constant");
  });

  it("keeps a daily series whose points reconstruct the totals", async () => {
    const r = await getCohortPnlService().decompose(BOOK);
    expect(r!.series).toHaveLength(2);
    const sumSel = r!.series.reduce((a, p) => a + p.selection, 0);
    const sumDrift = r!.series.reduce((a, p) => a + p.drift, 0);
    expect(sumSel).toBeCloseTo(r!.totals.selection, 12);
    expect(sumDrift).toBeCloseTo(r!.totals.drift, 12);
    for (const p of r!.series) {
      expect(p.selection + p.drift).toBeCloseTo(p.residual, 12);
    }
  });
});
