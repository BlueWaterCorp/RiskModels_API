/**
 * Peer variance shares — the aggregate choice, and the thin-cohort refusal.
 *
 * The bar this feeds draws the peer row as a stacked bar beside the entity's,
 * so the peer segments must sum to 100. That is what makes the aggregate a
 * correctness question rather than a taste one.
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

// Real XBI names at teo 2026-08-06, as FRACTIONS — which is what the store
// returns (l3_mkt_er 0.0158 is 1.58%). Their medians sum to 100.45% and their
// means to 100.00%: the measurement the mean/median decision rests on.
const REAL = [
  { s: "MDGL-US", mkt: 0.00406, sec: 0.01648, sub: 0.11038, res: 0.86908 },
  { s: "ACAD-US", mkt: 0.08137, sec: 0.12097, sub: 0.10262, res: 0.69504 },
  { s: "INCY-US", mkt: -0.00009, sec: 0.18832, sub: 0.0349, res: 0.77686 },
];

function seed(rows: typeof REAL, count: number) {
  // Pad to clear MIN_COHORT_MEMBERS by cycling the real rows.
  const padded = Array.from({ length: count }, (_, i) => rows[i % rows.length]!);
  const symbols = padded.map((r, i) => `${r.s}-${i}`);
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => Promise.resolve({ data: symbols.map((symbol) => ({ symbol })), error: null }),
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
          },
        },
      ]),
    ),
  );
}

describe("cohort variance shares", () => {
  beforeEach(() => {
    mockBatch.mockReset();
    mockFrom.mockReset();
  });

  it("returns means, and the four legs sum to 100", async () => {
    const { getCohortVarianceShares } = await import(
      "@/lib/risk/cohort-variance-shares-service"
    );
    seed(REAL, 30);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });

    expect(r.aggregate).toBe("mean");
    // The identity the stacked peer bar depends on. A median aggregate would
    // land near 100.45 here and quietly break it.
    expect(r.sum_pct).toBeCloseTo(100, 2);
    expect(r.market_er_pct).toBeCloseTo(2.845, 2);
    expect(r.residual_er_pct).toBeCloseTo(78.033, 2);
    expect(r.n_names).toBe(30);
  });

  it("does not clip negative shares", async () => {
    // INCY's market share is genuinely -0.01%. Clipping would break the sum.
    const { getCohortVarianceShares } = await import(
      "@/lib/risk/cohort-variance-shares-service"
    );
    seed([REAL[2]!], 25);
    const r = await getCohortVarianceShares({ cohort: "XBI", level: "subsector" });
    expect(r.market_er_pct).toBeLessThan(0);
    expect(r.sum_pct).toBeCloseTo(100, 2);
  });

  it("refuses a thin cohort rather than reporting it", async () => {
    const { getCohortVarianceShares, ThinCohortError } = await import(
      "@/lib/risk/cohort-variance-shares-service"
    );
    seed(REAL, 5);
    await expect(
      getCohortVarianceShares({ cohort: "XBI", level: "subsector" }),
    ).rejects.toThrow(ThinCohortError);
  });

  it("skips names missing any leg rather than composing a partial bar", async () => {
    const { getCohortVarianceShares } = await import(
      "@/lib/risk/cohort-variance-shares-service"
    );
    seed(REAL, 30);
    // Blank one leg on every third name; those must not contribute.
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
