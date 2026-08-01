import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalPortfolioSnapshot } from "@/lib/portfolio/canonical-snapshot";
import { runPortfolioRiskComputation } from "@/lib/portfolio/portfolio-risk-core";
import { fetchBatchHistory, resolveSymbolsByTickers } from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import type { SecurityHistoryRow, SymbolRegistryRow } from "@/lib/dal/risk-engine-v3";

vi.mock("@/lib/portfolio/portfolio-risk-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portfolio/portfolio-risk-core")>();
  return { ...actual, runPortfolioRiskComputation: vi.fn() };
});

vi.mock("@/lib/dal/risk-engine-v3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dal/risk-engine-v3")>();
  return { ...actual, fetchBatchHistory: vi.fn(), resolveSymbolsByTickers: vi.fn() };
});

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn().mockResolvedValue({
    model_version: "ERM3-L3-test",
    data_as_of: "2026-01-15",
    factor_set_id: "SPY_uni_mc_3000",
    universe_size: 3000,
    wiki_uri: "https://riskmodels.net/docs",
    factors: ["SPY"],
  }),
}));

const mockCoreOk = {
  status: "ok" as const,
  fetchLatencyMs: 1,
  portfolioER: { market: 0.6, sector: 0.15, subsector: 0.1, residual: 0.15 },
  systematic: 0.85,
  portfolioVol: 0.22,
  perTicker: {
    MSFT: {
      weight: 1,
      symbol: "FSYM_MSFT",
      teo: "2026-01-14",
      l3_mkt_er: 0.6,
      l3_sec_er: 0.15,
      l3_sub_er: 0.1,
      l3_res_er: 0.15,
      l3_mkt_hr: 0.9,
      l3_sec_hr: 0.1,
      l3_sub_hr: 0.05,
      vol_23d: 0.2,
      price_close: 300,
    },
  },
  summary: { total_positions: 1, resolved: 1, errors: 0 },
  errorsList: [] as { ticker: string; error: string }[],
  timeSeriesData: [
    { date: "2026-01-10", market_er: 0.4, sector_er: 0.2, subsector_er: 0.2, residual_er: 0.2, systematic_er: 0.8 },
  ],
};

function historyRowsForOneTicker(
  symbol: string,
  teos: string[],
  daily: { g: number; l1: number; l2: number; l3: number; rr: number; vol: number }[],
): SecurityHistoryRow[] {
  const keys = ["returns_gross", "l1_fr", "l2_fr", "l3_fr", "l3_rr", "vol_23d"] as const;
  const out: SecurityHistoryRow[] = [];
  for (let i = 0; i < teos.length; i++) {
    const t = teos[i]!;
    const d = daily[i]!;
    const vals = [d.g, d.l1, d.l2, d.l3, d.rr, d.vol];
    for (let k = 0; k < keys.length; k++) {
      out.push({
        symbol,
        teo: t,
        periodicity: "daily",
        metric_key: keys[k],
        metric_value: vals[k]!,
      });
    }
  }
  return out;
}

describe("buildCanonicalPortfolioSnapshot", () => {
  beforeEach(() => {
    vi.mocked(runPortfolioRiskComputation).mockReset();
    vi.mocked(runPortfolioRiskComputation).mockResolvedValue(mockCoreOk);
    const msftRow: SymbolRegistryRow = {
      symbol: "FSYM_MSFT",
      ticker: "MSFT",
      name: "Microsoft",
      asset_type: "stock",
      sector_etf: "XLK",
      subsector_etf: "SOXX",
      is_adr: false,
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    };
    vi.mocked(resolveSymbolsByTickers).mockResolvedValue(
      new Map<string, SymbolRegistryRow>([["MSFT", msftRow]]),
    );
    const teos = ["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13", "2026-01-14"];
    // l1_fr/l2_fr/l3_fr are per-level *incremental* legs, so g = l1 + l2 + l3 + rr.
    const daily = teos.map(() => ({ g: 0.01, l1: 0.006, l2: 0.0015, l3: 0.0005, rr: 0.002, vol: 0.2 }));
    vi.mocked(fetchBatchHistory).mockResolvedValue(
      historyRowsForOneTicker("FSYM_MSFT", teos, daily),
    );
  });

  it("returns strict top-level shape with concentration flags and systematic risk share", async () => {
    const r = await buildCanonicalPortfolioSnapshot({
      positions: [{ ticker: "MSFT", weight: 1 }],
      lookbackDays: 5,
      mode: "frozen",
      benchmark: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { body } = r;
    expect(body.snapshot).toBeDefined();
    expect(body.time_behavior).toBeDefined();
    expect(body.attribution).toBeDefined();
    expect(body.risk_summary).toBeDefined();
    expect(body.metadata).toBeDefined();
    expect(body.snapshot.variance_decomposition.systematic).toBeCloseTo(0.85);
    expect(body.risk_summary.concentration.high_single_name).toBe(true);
    expect(body.risk_summary.concentration.high_layer_concentration).toBe(true);
    expect(body.risk_summary.systematic_risk_share).toBeCloseTo(0.85 / (0.85 + 0.15));
    expect(body.time_behavior.cumulative_return.length).toBe(5);
    expect(body.time_behavior.drawdown.length).toBe(5);
    expect(getRiskMetadata).toHaveBeenCalled();
  });

  it("builds attribution strips from the per-level incremental legs (gross = m + s + u + r)", async () => {
    const r = await buildCanonicalPortfolioSnapshot({
      positions: [{ ticker: "MSFT", weight: 1 }],
      lookbackDays: 5,
      mode: "frozen",
      benchmark: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const att = r.body.attribution;
    // Single holding, weight 1 → strips are the raw per-level legs.
    expect(att.market[0]).toBeCloseTo(0.006, 10);
    expect(att.sector[0]).toBeCloseTo(0.0015, 10); // l2_fr directly, NOT l2_fr - l1_fr
    expect(att.subsector[0]).toBeCloseTo(0.0005, 10); // l3_fr directly, NOT l3_fr - l2_fr
    expect(att.residual[0]).toBeCloseTo(0.002, 10);
    for (let i = 0; i < att.gross.length; i++) {
      const sum = att.market[i]! + att.sector[i]! + att.subsector[i]! + att.residual[i]!;
      expect(att.gross[i]).toBeCloseTo(sum, 10);
    }
  });

  it("fills time_behavior when one of six holdings has no batch history (80% coverage tier)", async () => {
    const tickers = ["TKA", "TKB", "TKC", "TKD", "TKE", "TKF"] as const;
    const w = 1 / 6;
    const tickerRow = (ticker: string, symbol: string) => ({
      weight: w,
      symbol,
      teo: "2026-01-14",
      l3_mkt_er: 0.6,
      l3_sec_er: 0.15,
      l3_sub_er: 0.1,
      l3_res_er: 0.15,
      l3_mkt_hr: 0.9,
      l3_sec_hr: 0.1,
      l3_sub_hr: 0.05,
      vol_23d: 0.2,
      price_close: 100,
    });
    vi.mocked(runPortfolioRiskComputation).mockResolvedValue({
      ...mockCoreOk,
      perTicker: Object.fromEntries(
        tickers.map((t, i) => [
          t,
          tickerRow(t, `FSYM_${t}_${i}`),
        ]),
      ),
      summary: { total_positions: 6, resolved: 6, errors: 0 },
    });

    vi.mocked(resolveSymbolsByTickers).mockResolvedValue(
      new Map(
        tickers.map((t, i) => [
          t,
          {
            symbol: `FSYM_${t}_${i}`,
            ticker: t,
            name: t,
            asset_type: "stock",
            sector_etf: "XLK",
            subsector_etf: "SOXX",
            is_adr: false,
            is_modelled_class: true,
            modelled_ticker: null,
            share_class: null,
            modelled_share_class: null,
          } satisfies SymbolRegistryRow,
        ]),
      ),
    );

    const teos = ["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13", "2026-01-14"];
    const daily = teos.map(() => ({ g: 0.01, l1: 0.006, l2: 0.0015, l3: 0.0005, rr: 0.002, vol: 0.2 }));

    /** No rows for `TKF` — strict aggregation would omit every calendar day (<100% strip coverage). */
    const mergedHistory = tickers.slice(0, 5).flatMap((t, i) =>
      historyRowsForOneTicker(`FSYM_${t}_${i}`, teos, daily),
    );
    vi.mocked(fetchBatchHistory).mockResolvedValue(mergedHistory);

    const positions = tickers.map((t) => ({ ticker: t, weight: w }));
    const r = await buildCanonicalPortfolioSnapshot({
      positions,
      lookbackDays: 5,
      mode: "frozen",
      benchmark: null,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.body.time_behavior.teo.length).toBe(5);
    expect(r.body.time_behavior.cumulative_return.length).toBe(5);
    expect(r.body.attribution.gross.length).toBe(5);
    expect(typeof r.body.risk_summary.time_series_caveat).toBe("string");
    expect(r.body.risk_summary.time_series_caveat).toContain("80%");
  });

  it("slices to lookback length", async () => {
    const teos = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    const daily = teos.map(() => ({ g: 0, l1: 0, l2: 0, l3: 0, rr: 0, vol: 0.2 }));
    vi.mocked(fetchBatchHistory).mockResolvedValue(
      historyRowsForOneTicker("FSYM_MSFT", teos, daily),
    );
    const r = await buildCanonicalPortfolioSnapshot({
      positions: [{ ticker: "MSFT", weight: 1 }],
      lookbackDays: 3,
      mode: "frozen",
      benchmark: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.time_behavior.teo.length).toBe(3);
    expect(r.body.attribution.gross.length).toBe(3);
  });

  // L.8-v2 #2 — benchmark resolution via the catalog mirror.
  describe("benchmark_context_id (L.8-v2 #2)", () => {
    it("null benchmark → benchmark_context_id is null on snapshot + metadata", async () => {
      const r = await buildCanonicalPortfolioSnapshot({
        positions: [{ ticker: "MSFT", weight: 1 }],
        lookbackDays: 5,
        mode: "frozen",
        benchmark: null,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.body.snapshot.benchmark).toBeNull();
      expect(r.body.snapshot.benchmark_context_id).toBeNull();
      expect(r.body.metadata.benchmark).toBeNull();
      expect(r.body.metadata.benchmark_context_id).toBeNull();
    });

    it("alias 'SPY' resolves to BW-BENCH-SPY; raw string still echoed", async () => {
      const r = await buildCanonicalPortfolioSnapshot({
        positions: [{ ticker: "MSFT", weight: 1 }],
        lookbackDays: 5,
        mode: "frozen",
        benchmark: "SPY",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.body.snapshot.benchmark).toBe("SPY");
      expect(r.body.snapshot.benchmark_context_id).toBe("BW-BENCH-SPY");
      expect(r.body.metadata.benchmark).toBe("SPY");
      expect(r.body.metadata.benchmark_context_id).toBe("BW-BENCH-SPY");
    });

    it("alias '70/30' resolves to BW-BENCH-EQ70-30 (blend kind)", async () => {
      const r = await buildCanonicalPortfolioSnapshot({
        positions: [{ ticker: "MSFT", weight: 1 }],
        lookbackDays: 5,
        mode: "frozen",
        benchmark: "70/30",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.body.snapshot.benchmark).toBe("70/30");
      expect(r.body.snapshot.benchmark_context_id).toBe("BW-BENCH-EQ70-30");
    });

    it("bw-bench id passthrough is uppercased + preserved as benchmark_context_id", async () => {
      const r = await buildCanonicalPortfolioSnapshot({
        positions: [{ ticker: "MSFT", weight: 1 }],
        lookbackDays: 5,
        mode: "frozen",
        benchmark: "BW-BENCH-EQ70-30",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.body.snapshot.benchmark).toBe("BW-BENCH-EQ70-30");
      expect(r.body.snapshot.benchmark_context_id).toBe("BW-BENCH-EQ70-30");
    });

    it("unknown alias → benchmark_context_id null, raw string preserved (back-compat)", async () => {
      const r = await buildCanonicalPortfolioSnapshot({
        positions: [{ ticker: "MSFT", weight: 1 }],
        lookbackDays: 5,
        mode: "frozen",
        benchmark: "totally-unknown",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.body.snapshot.benchmark).toBe("totally-unknown");
      expect(r.body.snapshot.benchmark_context_id).toBeNull();
      expect(r.body.metadata.benchmark_context_id).toBeNull();
    });
  });
});
