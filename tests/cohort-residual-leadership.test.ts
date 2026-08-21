/**
 * Cohort residual leadership — response contract and the four traps.
 *
 * Contract first: dropping sd/median/best/worst, or returning a short list
 * instead of 422, is a defect the consumer (S10) already refuses on.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBatchHistory = vi.fn();
const mockFetchHistory = vi.fn();
const mockFrom = vi.fn();
const mockResolveSymbol = vi.fn();

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  fetchBatchHistory: (...a: unknown[]) => mockBatchHistory(...a),
  fetchHistory: (...a: unknown[]) => mockFetchHistory(...a),
  resolveSymbolByTicker: (...a: unknown[]) => mockResolveSymbol(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
}));

/** Build daily l3_rr rows for one symbol over `dates`. */
function rrRows(
  symbol: string,
  dates: string[],
  daily: number | ((i: number) => number | null),
) {
  return dates.map((teo, i) => ({
    symbol,
    teo,
    periodicity: "daily" as const,
    metric_key: "l3_rr" as const,
    metric_value: typeof daily === "function" ? daily(i) : daily,
  }));
}

/** 220 trading-day calendar ending 2026-08-07 (above MIN_WINDOW_OBS). */
function makeDates(n: number, end = "2026-08-07"): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    const cur = new Date(d);
    cur.setUTCDate(d.getUTCDate() - (n - 1 - i));
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

type Member = { symbol: string; ticker: string; daily: number };

function seed(opts: {
  members: Member[];
  windowDates: string[];
  /** ETF calendar dates used to define the window (defaults to windowDates). */
  etfDates?: string[];
  shortHistory?: Array<{ symbol: string; ticker: string; coverFirst?: number }>;
}) {
  const { members, windowDates } = opts;
  const etfDates = opts.etfDates ?? windowDates;
  const short = opts.shortHistory ?? [];

  const allMembers = [
    ...members.map((m) => ({ symbol: m.symbol, ticker: m.ticker })),
    ...short.map((m) => ({ symbol: m.symbol, ticker: m.ticker })),
  ];

  mockFrom.mockReturnValue({
    select: () => ({
      eq: () =>
        Promise.resolve({
          data: allMembers.map(({ symbol, ticker }) => ({ symbol, ticker })),
          error: null,
        }),
    }),
  });

  mockResolveSymbol.mockResolvedValue({
    symbol: "BW-SMH",
    ticker: "SMH",
    name: "VanEck Semiconductor ETF",
    asset_type: "etf",
    sector_etf: null,
    subsector_etf: null,
    is_adr: false,
    is_modelled_class: true,
    modelled_ticker: null,
  });

  // ETF calendar via returns_gross — defines the window (trap 1).
  const etfGross = etfDates.map((teo) => ({
    symbol: "BW-SMH",
    teo,
    periodicity: "daily" as const,
    metric_key: "returns_gross" as const,
    metric_value: 0.001,
  }));
  mockFetchHistory.mockResolvedValue(etfGross);

  const memberRows = [
    ...members.flatMap((m) => rrRows(m.symbol, windowDates, m.daily)),
    ...short.flatMap((m) => {
      const n = m.coverFirst ?? Math.floor(windowDates.length / 2);
      return rrRows(m.symbol, windowDates.slice(0, n), 0.001);
    }),
  ];

  mockBatchHistory.mockImplementation(async (symbols: string[]) => {
    const set = new Set(symbols);
    return memberRows.filter((r) => set.has(r.symbol));
  });
}

describe("cohort residual leadership — response contract", () => {
  beforeEach(() => {
    mockBatchHistory.mockReset();
    mockFetchHistory.mockReset();
    mockFrom.mockReset();
    mockResolveSymbol.mockReset();
  });

  it("returns sd, median, best, worst, n_ranked, and n_members", async () => {
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    // 25 members with known daily residuals so sums / dispersion are checkable.
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: (i - 12) * 0.0001, // rank by i
    }));
    seed({ members, windowDates: dates });

    const r = await getCohortResidualLeadership({
      cohort: "SMH",
      window: "252d",
      level: "subsector",
    });

    expect(r.dispersion).toEqual(
      expect.objectContaining({
        best: expect.any(Number),
        worst: expect.any(Number),
        median: expect.any(Number),
        sd: expect.any(Number),
      }),
    );
    expect(r.dispersion.sd).not.toBeNull();
    expect(r.dispersion.median).not.toBeNull();
    expect(r.n_ranked).toBe(25);
    expect(r.n_members).toBe(25);
    expect(r.n_short_history).toBe(0);
    expect(r.ranked).toHaveLength(25);
    expect(r.ranked[0]).toEqual(
      expect.objectContaining({
        symbol: expect.any(String),
        ticker: expect.any(String),
        rank: 1,
        value: expect.any(Number),
      }),
    );
  });

  it("sums daily residual returns — does not compound", async () => {
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    const daily = 0.01;
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily,
    }));
    seed({ members, windowDates: dates });

    const r = await getCohortResidualLeadership({
      cohort: "SMH",
      window: "252d",
      level: "subsector",
    });

    // Sum, not compound: 220 * 0.01 = 2.2. Compound would be (1.01)^220 - 1 ≈ 7.9.
    expect(r.ranked[0]!.value).toBeCloseTo(dates.length * daily, 6);
    expect(r.dispersion.best).toBeCloseTo(dates.length * daily, 6);
  });

  it("uses the ETF calendar window, dropping short-history members", async () => {
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: 0.001,
    }));
    seed({
      members,
      windowDates: dates,
      shortHistory: [
        { symbol: "BW-SHORT-A", ticker: "SHA", coverFirst: 100 },
        { symbol: "BW-SHORT-B", ticker: "SHB", coverFirst: 50 },
      ],
    });

    const r = await getCohortResidualLeadership({
      cohort: "SMH",
      window: "252d",
      level: "subsector",
    });

    expect(r.n_members).toBe(27);
    expect(r.n_ranked).toBe(25);
    expect(r.n_short_history).toBe(2);
    expect(r.obs).toBe(220);
    expect(r.ranked.some((row) => row.ticker === "SHA")).toBe(false);
  });

  it("refuses a thin cohort with ThinCohortError — never a short list", async () => {
    const { getCohortResidualLeadership, ThinCohortError } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    const members: Member[] = Array.from({ length: 4 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: 0.001,
    }));
    seed({ members, windowDates: dates });

    await expect(
      getCohortResidualLeadership({
        cohort: "SMH",
        window: "252d",
        level: "subsector",
      }),
    ).rejects.toThrow(ThinCohortError);
  });

  it("refuses when the resolved window has fewer than ~200 observations", async () => {
    const { getCohortResidualLeadership, ShortWindowError } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(150);
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: 0.001,
    }));
    seed({ members, windowDates: dates, etfDates: dates });

    await expect(
      getCohortResidualLeadership({
        cohort: "SMH",
        window: "252d",
        level: "subsector",
      }),
    ).rejects.toThrow(ShortWindowError);
  });

  it("404s an unknown cohort rather than reporting thin", async () => {
    const { getCohortResidualLeadership, UnknownCohortError } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    });
    mockResolveSymbol.mockResolvedValue(null);

    await expect(
      getCohortResidualLeadership({
        cohort: "ZZZZ",
        window: "252d",
        level: "subsector",
      }),
    ).rejects.toThrow(UnknownCohortError);
  });

  it("ranks descending by summed residual return", async () => {
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: i * 0.0001,
    }));
    seed({ members, windowDates: dates });

    const r = await getCohortResidualLeadership({
      cohort: "SMH",
      window: "252d",
      level: "subsector",
    });

    expect(r.ranked[0]!.ticker).toBe("T24");
    expect(r.ranked[0]!.rank).toBe(1);
    expect(r.ranked.at(-1)!.ticker).toBe("T0");
    expect(r.dispersion.best).toBeGreaterThan(r.dispersion.worst);
  });
});

describe("coverage is a tolerance, not an identity", () => {
  beforeEach(() => {
    mockBatchHistory.mockReset();
    mockFetchHistory.mockReset();
    mockFrom.mockReset();
    mockResolveSymbol.mockReset();
  });

  /** Members whose series has holes punched at the given indices. */
  function seedWithGaps(gapsByTicker: Record<string, number[]>, n = 220) {
    const dates = makeDates(n);
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: 0.0001,
    }));
    seed({ members, windowDates: dates });

    const base = mockBatchHistory.getMockImplementation()!;
    mockBatchHistory.mockImplementation(async (symbols: string[]) => {
      const rows = await base(symbols);
      return rows.filter((r: { symbol: string; teo: string }) => {
        const idx = Number(r.symbol.split("-")[1]);
        const holes = gapsByTicker[`T${idx}`];
        if (!holes) return true;
        return !holes.includes(dates.indexOf(r.teo));
      });
    });
    return dates;
  }

  const call = async () => {
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    return getCohortResidualLeadership({
      cohort: "SMH", window: "252d", level: "subsector",
    });
  };

  it("ranks a member missing a couple of days rather than dropping it", async () => {
    // The rule was "any missing day drops you", which excluded IONS from XBI
    // for 2 absent prints out of 252 — a complete record thrown away in the
    // name of comparability it was not threatening.
    seedWithGaps({ T3: [10, 99] });
    const r = await call();
    expect(r.ranked.some((x) => x.ticker === "T3")).toBe(true);
    expect(r.n_short_history).toBe(0);
    expect(r.n_partial_coverage).toBe(1);
  });

  it("reports the observed count per row, not just for the window", async () => {
    seedWithGaps({ T3: [10, 99] });
    const r = await call();
    const row = r.ranked.find((x) => x.ticker === "T3")!;
    const full = r.ranked.find((x) => x.ticker === "T4")!;
    expect(row.observed).toBe(r.obs - 2);
    expect(full.observed).toBe(r.obs);
  });

  it("still drops a member missing more than the tolerance", async () => {
    // 220-day window, 2% tolerance -> 4 days allowed; 20 is not a gap, it is a
    // different window, and that is what the rule exists to prevent.
    seedWithGaps({ T3: Array.from({ length: 20 }, (_, i) => i * 3) });
    const r = await call();
    expect(r.ranked.some((x) => x.ticker === "T3")).toBe(false);
    expect(r.n_short_history).toBe(1);
  });

  it("does not count a fully-covered member as partial", async () => {
    seedWithGaps({});
    const r = await call();
    expect(r.n_partial_coverage).toBe(0);
    expect(r.ranked.every((x) => x.observed === r.obs)).toBe(true);
  });
});

describe("the two exclusions are counted apart", () => {
  beforeEach(() => {
    mockBatchHistory.mockReset();
    mockFetchHistory.mockReset();
    mockFrom.mockReset();
    mockResolveSymbol.mockReset();
  });

  it("separates short-span from over-gapped, and n_short_history stays the total", async () => {
    // Panel-wide these are 17.9% and 3.1% respectively, so collapsing them hid
    // that the DESIGN exclusion — names that did not trade for part of the
    // window — is doing most of the work, not the data-quality one.
    const { getCohortResidualLeadership } = await import(
      "@/lib/risk/cohort-residual-leadership-service"
    );
    const dates = makeDates(220);
    // 25 so the over-gapped drop still leaves 24, above the 20-member floor —
    // the first attempt fell to 19 and hit the post-coverage thin-cohort check,
    // which is that check working rather than a fixture to route around.
    const members: Member[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: `BW-${i}`,
      ticker: `T${i}`,
      daily: 0.0001,
    }));
    seed({
      members,
      windowDates: dates,
      // Two names that only cover the first half — they never traded the rest.
      shortHistory: [
        { symbol: "BW-S1", ticker: "S1", coverFirst: 110 },
        { symbol: "BW-S2", ticker: "S2", coverFirst: 110 },
      ],
    });

    // And one name that spans the window but is missing 20 of 220 days.
    const base = mockBatchHistory.getMockImplementation()!;
    const holes = new Set(
      Array.from({ length: 20 }, (_, i) => dates[5 + i * 3]!),
    );
    mockBatchHistory.mockImplementation(async (symbols: string[]) => {
      const rows = await base(symbols);
      return rows.filter(
        (r: { symbol: string; teo: string }) =>
          !(r.symbol === "BW-3" && holes.has(r.teo)),
      );
    });

    const r = await getCohortResidualLeadership({
      cohort: "SMH", window: "252d", level: "subsector",
    });

    expect(r.n_short_span).toBe(2);
    expect(r.n_excluded_gaps).toBe(1);
    expect(r.n_short_history).toBe(3);
    expect(r.ranked.some((x) => x.ticker === "T3")).toBe(false);
    expect(r.ranked.some((x) => x.ticker === "S1")).toBe(false);
  });
});
