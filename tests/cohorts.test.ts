import { describe, expect, it, vi } from "vitest";

import {
  CohortCrossSectionRequestSchema,
  CohortSeriesRequestSchema,
} from "@/lib/api/schemas";

/**
 * H.146 — the cohort store's public surface.
 *
 * The load-bearing test here is the IP boundary. The store holds 54 cohorts;
 * 12 are public. The 42 L3 subsector cohorts are proprietary curation, and the
 * requirement is stronger than "don't serve them": a caller must not be able to
 * discover the roster by probing, so a real-but-private cohort has to be
 * rejected identically to a ticker that does not exist.
 *
 * Fixture values are real rows read from
 * ds_erm3_cohorts_SPY_uni_mc_3000.zarr at teo 2026-07-31.
 */

const ROSTER_FIXTURE = {
  entries: [
    {
      index: 0,
      bwSymId: "BW-US78462F1030",
      ticker: "SPY",
      level: 1 as const,
      parentTicker: null,
      validFrom: "2000-01-04",
      validTo: null,
    },
    {
      index: 1,
      bwSymId: "BW-US81369Y1001",
      ticker: "XLB",
      level: 2 as const,
      parentTicker: "SPY",
      validFrom: "2000-01-04",
      validTo: null,
    },
    {
      index: 2,
      bwSymId: "BW-US81369Y8527",
      ticker: "XLC",
      level: 2 as const,
      parentTicker: "SPY",
      validFrom: "2000-01-04",
      validTo: null,
    },
    // A real L3 cohort — present in the store, never addressable.
    {
      index: 3,
      bwSymId: "BW-US4642875235",
      ticker: "PRIVATE_L3",
      level: 3 as const,
      parentTicker: "XLC",
      validFrom: "2000-01-04",
      validTo: null,
    },
  ],
  byTicker: new Map<string, unknown>(),
  teos: ["2026-07-30", "2026-07-31"],
};
for (const e of ROSTER_FIXTURE.entries) {
  ROSTER_FIXTURE.byTicker.set(e.ticker, e);
}

const META_FIXTURE = {
  no_intercept_contract:
    "ERM3 residuals are estimated WITHOUT an intercept and therefore retain each stock's alpha. The cross-sectional mean is NOT zero. If you are building relative-ranking signals, demean first using residual_mean.",
  return_source_legend:
    "factor_source: 0=native ETF return, 1=primary proxy (real ETF), 2=chain proxy (deeper real ETF), 3=synthetic free-float index (FFX_*), 9=no data. Mirrors ds_etf.return_source.",
  build_timestamp: "2026-08-03T12:04:21",
  erm3_version: "81cfc00",
  market_factor_etf: "SPY",
  universe: "uni_mc_3000",
  rolling_window: 252,
  min_periods: 126,
  panel_start: "2000-01-03",
  panel_end: "2026-07-31",
};

const readCohortSeries = vi.fn();
const readCohortCrossSection = vi.fn();

vi.mock("@/lib/dal/cohort-zarr-reader", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/dal/cohort-zarr-reader")>();
  return {
    ...actual,
    readCohortRoster: vi.fn(async () => ROSTER_FIXTURE),
    readCohortStoreMeta: vi.fn(async () => META_FIXTURE),
    readCohortSeries: (...args: unknown[]) => readCohortSeries(...args),
    readCohortCrossSection: (...args: unknown[]) => readCohortCrossSection(...args),
  };
});

import {
  getCohortService,
  isPublicCohort,
  PUBLIC_COHORT_TICKERS,
  UnknownCohortError,
} from "@/lib/risk/cohort-service";

describe("cohort public scope", () => {
  it("exposes exactly SPY + the 11 GICS sector SPDRs", () => {
    expect(PUBLIC_COHORT_TICKERS).toHaveLength(12);
    expect(PUBLIC_COHORT_TICKERS).toContain("SPY");
    expect(PUBLIC_COHORT_TICKERS).toContain("XLRE");
    expect(isPublicCohort("xlk")).toBe(true);
  });

  it("treats a real L3 cohort exactly like a nonexistent one", async () => {
    const svc = getCohortService();
    // Both must fail the same way — otherwise the difference between the two
    // responses enumerates the private roster one probe at a time.
    const privateAttempt = svc.getSeries({ tickers: ["PRIVATE_L3"] });
    const garbageAttempt = svc.getSeries({ tickers: ["NOT_A_TICKER"] });

    await expect(privateAttempt).rejects.toBeInstanceOf(UnknownCohortError);
    await expect(garbageAttempt).rejects.toBeInstanceOf(UnknownCohortError);
    expect(isPublicCohort("PRIVATE_L3")).toBe(false);
  });

  it("defaults to the public set only, never the full store", async () => {
    readCohortSeries.mockResolvedValueOnce([]);
    await getCohortService().getSeries({});
    const passed = readCohortSeries.mock.calls[0]![0] as { tickers: string[] };
    expect(passed.tickers).toHaveLength(12);
    expect(passed.tickers).not.toContain("PRIVATE_L3");
  });

  it("omits L3 cohorts from the discovery roster", async () => {
    const roster = await getCohortService().getRoster();
    expect(roster!.cohorts.map((c) => c.ticker)).not.toContain("PRIVATE_L3");
    expect(roster!.cohorts.every((c) => c.level <= 2)).toBe(true);
  });

  it("never serializes the internal bw_sym_id", async () => {
    const roster = await getCohortService().getRoster();
    // Cohort ids are ISIN-flavored (H.24) — the wire shape must not carry them.
    expect(JSON.stringify(roster)).not.toContain("BW-US");
  });
});

describe("proxy_source labelling", () => {
  // `proxy_source` names the instrument backing a cohort's factor as a
  // bw_sym_id, and those are ISIN-flavored for most ETFs — VOX, which backs the
  // XLC cohort from 2004 to 2018, is BW-US92204A8844. Emitting that raw would
  // redistribute a licensed identifier (H.24).
  const roster = new Map([
    ["BW-US92204A8844", "VOX"],
    ["BW-US9229085538", "VNQ"],
  ]);

  it("resolves a known instrument to its ticker", async () => {
    const { publicProxyLabel } = await import("@/lib/dal/cohort-zarr-reader");
    expect(publicProxyLabel("BW-US92204A8844", roster)).toBe("VOX");
  });

  it("scrubs an ISIN-flavored id it cannot resolve", async () => {
    const { publicProxyLabel } = await import("@/lib/dal/cohort-zarr-reader");
    const label = publicProxyLabel("BW-US78462F1030", roster);
    expect(label).not.toContain("US78462F1030");
    expect(label).toBe("BW-RESTRICTED");
  });

  it("passes through a synthetic index id, which is not a licensed identifier", async () => {
    const { publicProxyLabel } = await import("@/lib/dal/cohort-zarr-reader");
    expect(publicProxyLabel("FFX_TELECOM", roster)).toBe("FFX_TELECOM");
  });

  it("treats an empty cell as absent rather than as an id", async () => {
    const { publicProxyLabel } = await import("@/lib/dal/cohort-zarr-reader");
    expect(publicProxyLabel("   ", roster)).toBeNull();
  });
});

describe("cohort disclosures", () => {
  it("carries the no-intercept contract verbatim from the store", async () => {
    const roster = await getCohortService().getRoster();
    expect(roster!.disclosures.no_intercept_contract).toBe(
      META_FIXTURE.no_intercept_contract,
    );
    // The whole point: it is read, not restated, so it cannot drift.
    expect(roster!.disclosures.no_intercept_contract).toContain("WITHOUT an intercept");
  });

  it("states coverage rather than letting callers infer 100%", async () => {
    const roster = await getCohortService().getRoster();
    expect(roster!.disclosures.coverage).toContain("88%");
  });

  it("frames dispersion as a conditioning variable, not a signal", async () => {
    const { dispersion_use } = (await getCohortService().getRoster())!.disclosures;
    expect(dispersion_use).toContain("not an alpha source");
    expect(dispersion_use).toContain("mean_pairwise_corr");
  });

  it("warns that cohort_ER is incremental and may be negative", async () => {
    const { er_sign } = (await getCohortService().getRoster())!.disclosures;
    expect(er_sign).toContain("incremental");
    expect(er_sign).toContain("linked_beta_r2");
  });
});

describe("cohort request schemas", () => {
  it("splits a comma-separated cohort list and upper-cases it", () => {
    const parsed = CohortCrossSectionRequestSchema.parse({ cohorts: "xlk, xlc" });
    expect(parsed.cohorts).toEqual(["XLK", "XLC"]);
  });

  it("rejects a malformed teo", () => {
    expect(
      CohortCrossSectionRequestSchema.safeParse({ teo: "07/31/2026" }).success,
    ).toBe(false);
  });

  it("rejects an inverted date range", () => {
    const result = CohortSeriesRequestSchema.safeParse({
      start_date: "2026-07-31",
      end_date: "2026-07-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a date range and coerces min_names", () => {
    const parsed = CohortSeriesRequestSchema.parse({
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      min_names: "20",
    });
    expect(parsed.min_names).toBe(20);
  });

  it("caps the cohort list at the size of the public set", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `X${i}`).join(",");
    expect(
      CohortCrossSectionRequestSchema.safeParse({ cohorts: thirteen }).success,
    ).toBe(false);
  });
});
