import { beforeEach, describe, expect, it, vi } from "vitest";

const SNAP = "2026-10-07";
// 300 consecutive days ending on the snapshot date.
const days = Array.from({ length: 300 }, (_, i) => {
  const d = new Date(`${SNAP}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (299 - i));
  return d.toISOString().slice(0, 10);
});

const registry: Record<string, Record<string, unknown>> = {
  NVDA: { symbol: "S-NVDA", ticker: "NVDA", asset_type: "stock", sector_etf: "XLK", subsector_etf: "SMH" },
  AMD: { symbol: "S-AMD", ticker: "AMD", asset_type: "stock", sector_etf: "XLK", subsector_etf: "SMH" },
  OLD: { symbol: "S-OLD", ticker: "OLD", asset_type: "stock", sector_etf: "XLF", subsector_etf: null },
  NEWCO: { symbol: "S-NEW", ticker: "NEWCO", asset_type: "stock", sector_etf: "XLK", subsector_etf: null },
  SPY: { symbol: "E-SPY", ticker: "SPY", asset_type: "etf", sector_etf: null, subsector_etf: null },
  XLK: { symbol: "E-XLK", ticker: "XLK", asset_type: "etf", sector_etf: null, subsector_etf: null },
  SMH: { symbol: "E-SMH", ticker: "SMH", asset_type: "etf", sector_etf: null, subsector_etf: null },
  XLF: { symbol: "E-XLF", ticker: "XLF", asset_type: "etf", sector_etf: null, subsector_etf: null },
};

const fullMetrics = (over: Record<string, number | null> = {}) => ({
  stock_var: 9e-4, l1_mkt_beta: 1.8, l1_mkt_hr: -1.8, l2_mkt_hr: -0.9, l2_sec_hr: -0.8,
  l3_mkt_hr: -0.5, l3_sec_hr: -0.4, l3_sub_hr: -0.7,
  l3_mkt_er: 0.3, l3_sec_er: 0.1, l3_sub_er: 0.2, l3_res_er: 0.4,
  l1_res_er: 0.6, l2_res_er: 0.5, lstar_level: 3, ...over,
});

const latestRows: Record<string, { teo: string; metrics: Record<string, number | null> }> = {
  // AMD's subsector leg is 0 in the latest table; Zarr has the real value.
  "S-NVDA": { teo: SNAP, metrics: fullMetrics() },
  "S-AMD": { teo: SNAP, metrics: fullMetrics({ l3_sub_hr: 0, l1_mkt_beta: 2.0 }) },
  "S-OLD": { teo: "2026-09-30", metrics: fullMetrics() },
  // Listed recently: in the model at the snapshot date, but every estimate empty.
  "S-NEW": { teo: SNAP, metrics: Object.fromEntries(Object.keys(fullMetrics()).map((k) => [k, null])) },
};

const historyCalls: Array<{ symbols: string[]; keys: string[]; opts: Record<string, unknown> }> = [];

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolsByTickers: vi.fn(async (ts: string[]) => {
    const m = new Map();
    for (const t of ts) if (registry[t]) m.set(t, registry[t]);
    return m;
  }),
  resolveSymbolByTicker: vi.fn(async () => null),
  fetchBatchLatestSummary: vi.fn(async (syms: string[]) => {
    const m = new Map();
    for (const s of syms) if (latestRows[s]) m.set(s, latestRows[s]);
    return m;
  }),
  fetchBatchHistory: vi.fn(async (symbols: string[], keys: string[], opts: Record<string, unknown>) => {
    historyCalls.push({ symbols, keys, opts });
    // The real DAL serves nothing when any key is outside Zarr (isZarrHistoryPath).
    if (keys.some((k) => ["l1_mkt_beta", "l2_sec_beta", "l3_sub_beta"].includes(k))) return [];
    if (keys.includes("returns_gross")) {
      return symbols.flatMap((s, k) =>
        days.map((d, i) => ({
          symbol: s, teo: d, periodicity: "daily", metric_key: "returns_gross",
          metric_value: Math.sin(i * (k + 1)) / 100,
        })),
      );
    }
    // Historical read (as_of): two dates for NVDA and AMD, newest after the requested date.
    if (opts.startDate !== opts.endDate) {
      const row = (symbol: string, teo: string, key: string, value: number) => ({
        symbol, teo, periodicity: "daily", metric_key: key, metric_value: value,
      });
      const out = [];
      for (const [sym, hr] of [["S-NVDA", -1.5], ["S-AMD", -2.2]] as const) {
        for (const teo of ["2024-06-27", "2024-06-28", "2024-07-01"]) {
          const m = fullMetrics({ l1_mkt_hr: teo === "2024-06-28" ? hr : -9 });
          for (const [k, v] of Object.entries(m)) if (k !== "l1_mkt_beta" && v != null) out.push(row(sym, teo, k, v as number));
        }
      }
      return out.filter((r) => r.teo <= String(opts.endDate) && r.teo >= String(opts.startDate));
    }
    // Zarr overlay read: AMD's real subsector leg at the snapshot date only.
    return symbols.includes("S-AMD")
      ? [{ symbol: "S-AMD", teo: SNAP, periodicity: "daily", metric_key: "l3_sub_hr", metric_value: -0.9 }]
      : [];
  }),
}));

import { computePortfolioExposure } from "@/lib/portfolio/signed-exposure-data";

describe("computePortfolioExposure (loader)", () => {
  beforeEach(() => {
    historyCalls.length = 0;
  });

  it("nets repeated tickers, fills empty hedge legs from Zarr, drops stale and unknown names", async () => {
    const out: any = await computePortfolioExposure(
      [
        { ticker: "NVDA", value: 60_000 },
        { ticker: "nvda", value: 40_000 },
        { ticker: "AMD", value: -50_000 },
        { ticker: "OLD", value: 10_000 },
        { ticker: "NOPE", value: 5_000 },
        { ticker: "SPY", value: -20_000 },
      ],
      { lookbackDays: 252 },
    );

    expect(out.as_of.snapshot_teo).toBe(SNAP);
    expect(out.as_of.covariance_end).toBe(SNAP);
    expect(out.as_of.vintage_aligned).toBe(true);
    expect(out.book.gross_usd).toBe(185_000);
    expect(out.book.modelled_stocks).toBe(2);
    expect(out.book.direct_etfs).toBe(1);

    // NVDA netted to 100k; AMD's subsector leg came from Zarr (-0.9), not 0.
    const l3 = out.hedges.l3.stock_hedge_trade_usd;
    expect(l3.SMH).toBeCloseTo(100_000 * -0.7 + -50_000 * -0.9, 2);

    const reasons = Object.fromEntries(out.coverage.dropped.map((d: any) => [d.ticker, d.reason]));
    expect(reasons).toEqual({ OLD: "stale_metrics", NOPE: "symbol_not_found" });

    // The Zarr overlay read is pinned to the snapshot date.
    const overlay = historyCalls.find((c) => !c.keys.includes("returns_gross"))!;
    expect(overlay.symbols).toEqual(["S-AMD"]);
    expect(overlay.opts.startDate).toBe(SNAP);
    expect(overlay.opts.endDate).toBe(SNAP);
    // The covariance read ends on the snapshot date.
    const covRead = historyCalls.find((c) => c.keys.includes("returns_gross"))!;
    expect(covRead.opts.endDate).toBe(SNAP);

    // SPY held directly offsets part of the stock hedge.
    expect(out.hedges.l1.direct_etf_exposure_usd.SPY).toBe(-20_000);
    expect(out.risk.systematic.daily_vol_usd).toBeGreaterThan(0);
  });

  it("drops a name with too little history as insufficient_history", async () => {
    const out: any = await computePortfolioExposure(
      [
        { ticker: "NVDA", value: 100_000 },
        { ticker: "NEWCO", value: 20_000 },
      ],
      { lookbackDays: 252 },
    );
    expect(out.coverage.dropped).toEqual([{ ticker: "NEWCO", value_usd: 20_000, reason: "insufficient_history" }]);
    expect(out.book.modelled_stocks).toBe(1);
  });

  it("returns an error when nothing in the book is modelled", async () => {
    const out: any = await computePortfolioExposure([{ ticker: "NOPE", value: 1_000 }], { lookbackDays: 252 });
    expect(out.error).toBe("no_risk_metrics");
    expect(out.dropped[0].reason).toBe("symbol_not_found");
  });
  it("as_of reads Zarr at the newest row on or before the date, with L1 beta = -l1_mkt_hr", async () => {
    const out: any = await computePortfolioExposure(
      [
        { ticker: "NVDA", value: 100_000 },
        { ticker: "AMD", value: -50_000 },
      ],
      { lookbackDays: 252, asOf: "2024-06-30" },
    );
    // 2024-07-01 is after as_of and must not be used; 2024-06-28 is the newest on or before it.
    expect(out.as_of.requested_as_of).toBe("2024-06-30");
    expect(out.as_of.snapshot_teo).toBe("2024-06-28");
    expect(out.beta.stock_beta_usd).toBeCloseTo(100_000 * 1.5 + -50_000 * 2.2, 2);

    const stockReads = historyCalls.filter((c) => !c.keys.includes("returns_gross"));
    expect(stockReads).toHaveLength(1);
    expect(stockReads[0]!.keys).not.toContain("l1_mkt_beta");
    expect(stockReads[0]!.opts.endDate).toBe("2024-06-30");
    const covRead = historyCalls.find((c) => c.keys.includes("returns_gross"))!;
    expect(covRead.opts.endDate).toBe("2024-06-28");
  });
});
