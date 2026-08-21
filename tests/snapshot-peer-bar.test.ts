import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThinCohortError } from "@/lib/risk/cohort-variance-shares-service";

const mockShares = vi.fn();

vi.mock("@/lib/risk/cohort-variance-shares-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/risk/cohort-variance-shares-service")
  >("@/lib/risk/cohort-variance-shares-service");
  return {
    ...actual,
    getCohortVarianceShares: (...a: unknown[]) => mockShares(...a),
  };
});

import {
  formatLargestPeerTickers,
  loadPeerVarianceBar,
  peerCohortAttempts,
} from "@/lib/portfolio/snapshot-peer-bar";

describe("peerCohortAttempts", () => {
  it("tries subsector then sector for AAPL-style RSPT / XLK", () => {
    expect(
      peerCohortAttempts({ subsector_etf: "RSPT", sector_etf: "XLK" }),
    ).toEqual([
      { cohort: "RSPT", level: "subsector" },
      { cohort: "XLK", level: "sector" },
    ]);
  });

  it("still tries sector when both tags are the same ETF", () => {
    expect(
      peerCohortAttempts({ subsector_etf: "XLK", sector_etf: "XLK" }),
    ).toEqual([
      { cohort: "XLK", level: "subsector" },
      { cohort: "XLK", level: "sector" },
    ]);
  });
});

describe("formatLargestPeerTickers", () => {
  it("joins ten names and ellipsizes the rest of the cohort", () => {
    expect(
      formatLargestPeerTickers(
        ["MSFT", "ORCL", "NOW", "CRM", "ADBE", "INTU", "PANW", "SNPS", "CRWD", "CDNS"],
        216,
      ),
    ).toBe("MSFT · ORCL · NOW · CRM · ADBE · INTU · PANW · SNPS · CRWD · CDNS · ...");
  });

  it("omits the ellipsis when the whole cohort is shown", () => {
    expect(formatLargestPeerTickers(["XBI", "REGN"], 2)).toBe("XBI · REGN");
  });
});

describe("loadPeerVarianceBar", () => {
  beforeEach(() => {
    mockShares.mockReset();
  });

  it("falls back to sector when the subsector cohort is one name below the floor", async () => {
    mockShares.mockImplementation(async (params: { cohort: string; level: string }) => {
      if (params.cohort === "RSPT") throw new ThinCohortError("RSPT", 4);
      return {
        cohort: "XLK",
        level: "sector",
        n_names: 394,
        largest_tickers: [
          "MSFT",
          "ORCL",
          "NOW",
          "CRM",
          "ADBE",
          "INTU",
          "PANW",
          "SNPS",
          "CRWD",
          "CDNS",
        ],
        equal_weighted_mean: {
          market_er_pct: 12,
          sector_er_pct: 18,
          subsector_er_pct: 10,
          residual_er_pct: 60,
          sum_pct: 100,
        },
      };
    });

    const bar = await loadPeerVarianceBar("AAPL", {
      subsector_etf: "RSPT",
      sector_etf: "XLK",
      symbol: "AAPL-US",
    });
    expect(bar?.label).toBe("XLK sector peers · 394 names · equal-weighted");
    expect(bar?.membersLine).toBe("MSFT · ORCL · NOW · CRM · ADBE · INTU · PANW · SNPS · CRWD · CDNS · ...");
    expect(bar?.residual).toBeCloseTo(0.6);
    expect(mockShares).toHaveBeenCalledTimes(2);
  });
});
