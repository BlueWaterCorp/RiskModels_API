/**
 * fetchLatestMetrics — historical asOf window bounds (G.42, zarr reader mocked).
 *
 * The DAL already implemented "latest complete row ≤ endDate"; the asOf
 * parameter must (1) cap endDate at the requested date so a later row can
 * never be served, (2) keep the same calendar lookback, and (3) leave the
 * no-asOf path on the metadata-driven window unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dal/zarr-reader", () => ({
  readHistorySlice: vi.fn(),
  readLatestRankSnapshot: vi.fn(),
  readRankingsCrossSection: vi.fn(),
  readSymbolRankSnapshot: vi.fn(),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(),
}));

import { readHistorySlice } from "@/lib/dal/zarr-reader";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { fetchLatestMetrics } from "@/lib/dal/risk-engine-v3";

const mockSlice = readHistorySlice as unknown as ReturnType<typeof vi.fn>;
const mockMetadata = getRiskMetadata as unknown as ReturnType<typeof vi.fn>;

function rows(entries: Array<[string, string, number]>) {
  return {
    rows: entries.map(([teo, metric_key, metric_value]) => ({
      symbol: "SYM_NVDA",
      teo,
      periodicity: "daily" as const,
      metric_key,
      metric_value,
    })),
  };
}

beforeEach(() => {
  mockSlice.mockReset();
  mockMetadata.mockReset().mockResolvedValue({
    model_version: "v3-test",
    data_as_of: "2026-07-31",
    factor_set_id: "SPY_uni_mc_3000",
    universe_size: 3000,
    wiki_uri: "https://example.test/wiki",
    factors: ["SPY"],
  });
});

describe("fetchLatestMetrics with asOf", () => {
  it("bounds the zarr read at asOf (endDate = asOf, 400d lookback)", async () => {
    mockSlice.mockResolvedValue(
      rows([
        ["2025-06-27", "l3_mkt_er", 0.5],
        ["2025-06-27", "l3_res_er", 0.35],
      ]),
    );

    const out = await fetchLatestMetrics(
      "SYM_NVDA",
      ["l3_mkt_er", "l3_res_er"],
      "daily",
      "2025-06-30",
    );

    expect(mockSlice).toHaveBeenCalledTimes(1);
    const call = mockSlice.mock.calls[0][0];
    expect(call.endDate).toBe("2025-06-30");
    // 400 calendar days before 2025-06-30.
    expect(call.startDate).toBe("2024-05-26");
    expect(out?.teo).toBe("2025-06-27");
    expect(out?.metrics.l3_mkt_er).toBeCloseTo(0.5, 6);
  });

  it("serves the newest complete row ≤ asOf when several exist", async () => {
    mockSlice.mockResolvedValue(
      rows([
        ["2025-06-27", "l3_mkt_er", 0.5],
        ["2025-06-27", "l3_res_er", 0.35],
        ["2025-06-20", "l3_mkt_er", 0.48],
        ["2025-06-20", "l3_res_er", 0.37],
      ]),
    );

    const out = await fetchLatestMetrics(
      "SYM_NVDA",
      ["l3_mkt_er", "l3_res_er"],
      "daily",
      "2025-06-30",
    );
    expect(out?.teo).toBe("2025-06-27");
  });

  it("returns null when the window ≤ asOf holds no rows (predates history)", async () => {
    mockSlice.mockResolvedValue({ rows: [] });
    const out = await fetchLatestMetrics(
      "SYM_NVDA",
      ["l3_mkt_er"],
      "daily",
      "1999-01-04",
    );
    expect(out).toBeNull();
    expect(mockSlice.mock.calls[0][0].endDate).toBe("1999-01-04");
  });

  it("without asOf, keeps the metadata-driven latest window (default unchanged)", async () => {
    mockSlice.mockResolvedValue(rows([["2026-07-31", "l3_mkt_er", 0.34]]));
    const out = await fetchLatestMetrics("SYM_NVDA", ["l3_mkt_er"], "daily");
    expect(mockMetadata).toHaveBeenCalled();
    expect(mockSlice.mock.calls[0][0].endDate).toBe("2026-07-31");
    expect(out?.teo).toBe("2026-07-31");
  });
});
