/**
 * Peer variance shares — the aggregates, and the thin-cohort refusal.
 *
 * Quartiles are the primary statistic (CEO ruling 2026-08-07) and the
 * AUM-weighted mean the labelled secondary. The equal-weighted mean stays
 * because a stacked peer bar has to draw something whose segments sum, and
 * marginal quartiles do not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBatch = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  fetchBatchLatestSummary: (...a: unknown[]) => mockBatch(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
}));

// Real XBI names at teo 2026-08-06, shares as FRACTIONS (which is what the
// store returns: l3_mkt_er 0.0158 is 1.58%) and market caps in dollars.
// Their marginal medians sum to 100.45% and their means to 100.00% — the
// measurement the aggregate decision rests on.
const REAL = [
  { s: "MDGL-US", mkt: 0.00406, sec: 0.01648, sub: 0.11038, res: 0.86908, cap: 11_759_673_344 },
  { s: "ACAD-US", mkt: 0.08137, sec: 0.12097, sub: 0.10262, res: 0.69504, cap: 4_867_402_752 },
  { s: "INCY-US", mkt: -0.00009, sec: 0.18832, sub: 0.0349, res: 0.77686, cap: 23_669_891_072 },
];

function seed(
  rows: typeof REAL,
  count: number,
  capOverride?: (i: number) => number | null,
) {
  const padded = Array.from({ length: count }, (_, i) => rows[i % rows.length]!);
  const symbols = padded.map((r, i) => `${r.s}-${i}`);
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () =>
        Promise.resolve({ data: symbols.map((symbol) => ({ symbol })), error: null }),
    }),
  });
  mockBatch.mockResolvedValue(
    new Map(
      padded.map((r, i) => [
        symbols[i]!,
        {
          teo: "2026-08-06",
          metrics: {
            l3_mkt_er: r.mkt,
            l3_sec_er: r.sec,
            l3_sub_er: r.sub,
            l3_res_er: r.res,
            market_cap: capOverride ? capOverride(i) : r.cap,
          },
        },
      ]),
    ),
  );
}

async function svc() {
  return import("@/lib/risk/cohort-variance-shares-service");
}

describe("cohort variance shares", () => {
  beforeEach(() => {
    mockBatch.mockReset();
    mockFrom.mockReset();
  });

  it("both means sum to 100 — they are what a stacked bar may draw", async () => {
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    expect(r.equal_weighted_mean.sum_pct).toBeCloseTo(100, 2);
    expect(r.aum_weighted_mean.sum_pct).toBeCloseTo(100, 2);
    expect(r.equal_weighted_mean.market_er_pct).toBeCloseTo(2.845, 2);
    expect(r.equal_weighted_mean.residual_er_pct).toBeCloseTo(78.033, 2);
  });

  it("marginal quartile medians do NOT sum to 100, and the field says so", async () => {
    // The whole reason quartiles cannot be the stacked bar: each leg's median
    // comes from a different name, so together they describe no portfolio.
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    expect(r.quartiles.p50_sum_pct).toBeCloseTo(100.45, 1);
    expect(Math.abs(r.quartiles.p50_sum_pct - 100)).toBeGreaterThan(0.1);
    expect(r.disclosures.marginal_quartiles).toMatch(/NOT sum to 100/);
  });

  it("quartiles bracket the median on every leg", async () => {
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    for (const leg of [
      "market_er_pct",
      "sector_er_pct",
      "subsector_er_pct",
      "residual_er_pct",
    ] as const) {
      const q = r.quartiles[leg];
      expect(q.p25).toBeLessThanOrEqual(q.p50);
      expect(q.p50).toBeLessThanOrEqual(q.p75);
    }
  });

  it("weighting by size moves the answer away from equal weighting", async () => {
    // INCY is ~5x ACAD by cap and carries far less market ER, so cap-weighting
    // pulls the market leg down. If these ever matched, weights are not applied.
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    expect(r.aum_weighted_mean.market_er_pct).toBeLessThan(
      r.equal_weighted_mean.market_er_pct,
    );
    expect(r.n_weighted).toBe(30);
  });

  it("a name with no usable size still counts equal-weighted, not weighted", async () => {
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30, (i) => (i % 3 === 0 ? null : 1_000_000_000));
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    expect(r.n_names).toBe(30);
    expect(r.n_weighted).toBe(20);
    expect(r.equal_weighted_mean.sum_pct).toBeCloseTo(100, 2);
    expect(r.aum_weighted_mean.sum_pct).toBeCloseTo(100, 2);
  });

  it("does not clip negative shares", async () => {
    // INCY's market share is genuinely -0.01%. Clipping would break the sum.
    const { getCohortVarianceShares } = await svc();
    seed([REAL[2]!], 25);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });
    expect(r.equal_weighted_mean.market_er_pct).toBeLessThan(0);
    expect(r.equal_weighted_mean.sum_pct).toBeCloseTo(100, 2);
  });

  it("refuses a thin cohort rather than reporting it", async () => {
    const { getCohortVarianceShares, ThinCohortError } = await svc();
    seed(REAL, 5);
    await expect(
      getCohortVarianceShares({ cohort: "XBI", level: "subsector" }),
    ).rejects.toThrow(ThinCohortError);
  });

  it("skips names missing any leg rather than composing a partial bar", async () => {
    const { getCohortVarianceShares } = await svc();
    seed(REAL, 30);
    mockBatch.mockResolvedValue(
      new Map(
        Array.from({ length: 30 }, (_, i) => [
          `S-${i}`,
          {
            teo: "2026-08-06",
            metrics: {
              l3_mkt_er: i % 3 === 0 ? null : 0.01,
              l3_sec_er: 0.02,
              l3_sub_er: 0.07,
              l3_res_er: 0.9,
              market_cap: 1_000_000_000,
            },
          },
        ]),
      ),
    );
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });
    expect(r.n_names).toBe(20);
    expect(r.n_universe).toBe(30);
  });
});
