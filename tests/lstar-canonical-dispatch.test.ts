import { beforeEach, describe, expect, it, vi } from "vitest";
import { LstarRequestSchema, BatchLstarRequestSchema } from "@/lib/api/schemas";
import { LstarService } from "@/lib/risk/lstar-service";
import { fetchBatchLstar } from "@/lib/risk/batch-lstar-service";
import { buildHedgeBasket, computeHedgeRecommendationSnapshot } from "@/lib/risk/hedge-recommendation-service";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async () => ({ symbol: "test-symbol" })),
  fetchHistory: mocks.history,
  pivotHistory: (rows: unknown) => rows,
  extractMetric: (row: Record<string, number>, key: string) => row[key] ?? null,
}));

// Deliberately distinct SPY ratios at each level. ER implies L2, GBM can pick any level.
const row = {
  teo: "2026-09-08", lstar_level: 3, lstar_rr: .033,
  l1_mkt_hr: -1.9, l2_mkt_hr: -.24, l2_sec_hr: -.96,
  l3_mkt_hr: -.69, l3_sec_hr: -.11, l3_sub_hr: -.43,
  l1_mkt_er: .42, l2_mkt_er: .42, l2_sec_er: .11,
  l3_mkt_er: .42, l3_sec_er: .11, l3_sub_er: -.007,
  l1_rr: .011, l2_rr: .022, l3_rr: .033,
};

beforeEach(() => { mocks.history.mockReset(); mocks.history.mockResolvedValue([row]); });

describe("request parsing through LSTAR hedge dispatch", () => {
  it.each([
    [1, -1.9, null, null, .011],
    [2, -.24, -.96, null, .022],
    [3, -.69, -.11, -.43, .033],
  ])("dispatches all ratios and residual for materialized L%s", async (level, market, sector, sub, rr) => {
    mocks.history.mockResolvedValue([{ ...row, lstar_level: level, lstar_rr: rr }]);
    const parsed = LstarRequestSchema.parse({ ticker: "NVDA" });
    const result = await new LstarService().getLstar(parsed.ticker, parsed.market_factor_etf, parsed);
    expect(parsed.threshold).toBeUndefined();
    expect(result).toMatchObject({ lstar: [`L${level}`], market_hr: [market], sector_hr: [sector], subsector_hr: [sub], residual_return: [rr] });
    expect(mocks.history.mock.calls[0]![1]).toContain("lstar_level");
  });

  it("batch omission also keeps the canonical selection and L3 SPY ratio", async () => {
    const parsed = BatchLstarRequestSchema.parse({ tickers: ["NVDA"] });
    const result = await fetchBatchLstar(parsed);
    expect(parsed.threshold).toBeUndefined();
    expect(result.results.NVDA).toMatchObject({lstar: ["L3"], market_hr: [-.69], sector_hr: [-.11], subsector_hr: [-.43]});
  });

  it("explicit 1% override uses the entire L2 vector, not truncated L3", async () => {
    const parsed = LstarRequestSchema.parse({ ticker: "NVDA", threshold: "0.01" });
    const result = await new LstarService().getLstar(parsed.ticker, "SPY", parsed);
    expect(result).toMatchObject({lstar: ["L2"], market_hr: [-.24], sector_hr: [-.96], subsector_hr: [null], residual_return: [.022]});
  });

  it.each([0, null, 1.5])("does not invent a hedge for no/invalid engine selection %s", async level => {
    mocks.history.mockResolvedValue([{ ...row, lstar_level: level }]);
    const result = await new LstarService().getLstar("NVDA");
    expect(result).toMatchObject({lstar: [null], market_hr: [null], sector_hr: [null], subsector_hr: [null], residual_return: [null]});
  });

  it("preserves missing active hedge ratios instead of substituting another level", async () => {
    mocks.history.mockResolvedValue([{ ...row, l3_mkt_hr: null }]);
    const result = await new LstarService().getLstar("NVDA");
    expect(result).toMatchObject({lstar: ["L3"], market_hr: [null], sector_hr: [-.11], subsector_hr: [-.43]});
  });
});

describe("snapshot recommendation and actual basket legs", () => {
  it("uses the engine pick even when marginal ER suggests L2", () => {
    const result = computeHedgeRecommendationSnapshot(row);
    expect(result.lstar).toBe("L3");
    // Existing economic policy is separate: negative subsector ER downgrades execution to L2.
    expect(result.recommended_hedge_level).toBe("L2");
  });
  it.each([
    [1, [1, -1.9]],
    [2, [1, -.24, -.96]],
    [3, [1, -.69, -.11, -.43]],
  ])("basket at L%s contains the matching SPY and finer hedge ratios", (level, positions) => {
    const basket = buildHedgeBasket({ ...row, lstar_level: level, l3_sub_er: .1,
      ticker: "NVDA", as_of: row.teo, beta_m_aapl: 1.9,
      sector_etf_ticker: "XLK", subsector_etf_ticker: "SMH",
      lambda_s_to_m: 1.7, lambda_u_to_m: 2, user_segment: "stat_arb" });
    expect(basket.lstar).toBe(`L${level}`);
    expect(basket.recommended_hedge_level).toBe(`L${level}`);
    expect(basket.legs.map(l => l.position)).toEqual(positions);
    expect(basket.decision_trace[0]).toContain("materialized engine selection");
  });
});
