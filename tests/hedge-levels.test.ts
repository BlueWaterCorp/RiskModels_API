import { describe, expect, it } from "vitest";

import {
  aggregatePortfolioHedgeLevels,
  buildHedgeLevels,
  notionalsFromLevelSnapshot,
  type HedgeLevelsBlock,
} from "@/lib/risk/hedge-levels";

const XLK_ETFS = {
  market_etf: "SPY",
  sector_etf: "XLK",
  subsector_etf: "SOXX",
} as const;

/** AAPL-ish scalars from hedge-recommendation-service.test.ts */
const AAPL_METRICS = {
  l1_mkt_hr: -0.862,
  l1_mkt_er: 0.4,
  l1_res_er: 0.6,
  l2_mkt_hr: -1.396,
  l2_sec_hr: 0.357,
  l2_mkt_er: 0.35,
  l2_sec_er: 0.007,
  l2_res_er: 0.643,
  l3_mkt_hr: -2.002,
  l3_sec_hr: -0.026,
  l3_sub_hr: 0.41,
  l3_mkt_er: 0.31,
  l3_sec_er: 0.02,
  l3_sub_er: 0.02,
  l3_res_er: 0.65,
};

describe("buildHedgeLevels", () => {
  it("fills L1 with market leg only + null sector/subsector", () => {
    const b = buildHedgeLevels(AAPL_METRICS, XLK_ETFS, {
      recommended_level: "L1",
      statistical_lstar: "L3",
    });
    expect(b.L1.market_hr).toBeCloseTo(-0.862, 6);
    expect(b.L1.sector_hr).toBeNull();
    expect(b.L1.subsector_hr).toBeNull();
    expect(b.L1.hedge_etfs).toEqual({ market: "SPY", sector: null, subsector: null });

    expect(b.L2.market_hr).toBeCloseTo(-1.396, 6);
    expect(b.L2.sector_hr).toBeCloseTo(0.357, 6);
    expect(b.L2.subsector_hr).toBeNull();
    expect(b.L2.hedge_etfs.market).toBe("SPY");
    expect(b.L2.hedge_etfs.sector).toBe("XLK");

    expect(b.L3.subsector_hr).toBeCloseTo(0.41, 6);
    expect(b.L3.hedge_etfs.subsector).toBe("SOXX");

    expect(b.recommended_level).toBe("L1");
    expect(b.statistical_lstar).toBe("L3");
  });

  it("distinct L1/L2/L3 market (and sector) HRs route to matching blocks — no cross-level bleed", () => {
    const b = buildHedgeLevels(
      {
        ...AAPL_METRICS,
        l1_mkt_hr: 1,
        l2_mkt_hr: 2,
        l2_sec_hr: 20,
        l3_mkt_hr: 3,
        l3_sec_hr: 30,
        l3_sub_hr: 300,
      },
      XLK_ETFS,
    );
    expect(b.L1.market_hr).toBe(1);
    expect(b.L2.market_hr).toBe(2);
    expect(b.L2.sector_hr).toBe(20);
    expect(b.L3.market_hr).toBe(3);
    expect(b.L3.sector_hr).toBe(30);
    expect(b.L3.subsector_hr).toBe(300);
    // Sanity: orthogonal cascade implies L* market hrs often differ numerically —
    // if these ever collide here, LEVEL_SCALAR_WIRE / pickWire regressions failed.
    expect(new Set([b.L1.market_hr, b.L2.market_hr, b.L3.market_hr]).size).toBe(3);
  });

  it("coerces numeric strings safely", () => {
    const b = buildHedgeLevels({ l3_mkt_hr: "-1.25" }, {
      ...XLK_ETFS,
      sector_etf: "XLK",
      subsector_etf: null,
    });
    expect(b.L3.market_hr).toBeCloseTo(-1.25, 6);
  });
});

describe("aggregatePortfolioHedgeLevels", () => {
  it("averages overlapping tickers weighted", () => {
    const nvdaLike: HedgeLevelsBlock = buildHedgeLevels(
      {
        ...AAPL_METRICS,
        l1_mkt_hr: -2,
        l2_mkt_hr: -2,
      },
      XLK_ETFS,
    );

    const aaplLike = buildHedgeLevels(AAPL_METRICS, XLK_ETFS);

    const agg = aggregatePortfolioHedgeLevels(
      { AAPL: 0.5, NVDA: 0.5 },
      { AAPL: aaplLike, NVDA: nvdaLike },
    );

    expect(agg.L1.market_hr).toBeCloseTo((-0.862 + -2) / 2, 6);
    expect(agg.L1.sector_hr).toBeNull();
  });

  it("skips entries with missing blocks", () => {
    const aaplLike = buildHedgeLevels(AAPL_METRICS, XLK_ETFS);
    const agg = aggregatePortfolioHedgeLevels(
      { AAPL: 0.75, MISSING: 0.25 },
      { AAPL: aaplLike, MISSING: undefined },
    );
    expect(agg.L1.market_hr).toBeCloseTo(-0.862, 6);
  });
});

describe("notionalsFromLevelSnapshot", () => {
  it("sums HR on duplicate ETF ticker then scales USD", () => {
    const snap = buildHedgeLevels(
      {
        l3_mkt_hr: -1,
        l3_sec_hr: 0.2,
        l3_sub_hr: 0.3,
        l3_mkt_er: 0.25,
        l3_sec_er: 0.25,
        l3_sub_er: 0.25,
        l3_res_er: 0.25,
      },
      { market_etf: "SPY", sector_etf: "XLK", subsector_etf: "XLK" },
    ).L3;

    const legs = notionalsFromLevelSnapshot(10_000, snap);
    const xlk = legs.find((l) => l.etf === "XLK");
    expect(xlk?.hr).toBeCloseTo(0.5, 6); // 0.2 + 0.3
    expect(xlk?.hedge_usd).toBeCloseTo(5_000, 6);

    const spy = legs.find((l) => l.etf === "SPY");
    expect(spy?.hedge_usd).toBeCloseTo(-10_000, 6);
  });
});
