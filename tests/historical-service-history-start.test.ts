import { beforeEach, describe, expect, it, vi } from "vitest";

const history = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async (ticker: string) => ({ symbol: ticker })),
  fetchHistoryWithSource: history,
  pivotHistory: vi.fn((rows: unknown[]) => rows),
  extractMetric: vi.fn((row: Record<string, unknown>, key: string) => row[key] ?? null),
}));

import {
  L3DecompositionService,
  toL3DecompositionPublicBody,
} from "@/lib/risk/l3-decomposition-service";
import {
  ReturnsDecompositionService,
  toReturnsDecompositionPublicBody,
} from "@/lib/risk/returns-decomposition-service";
import { LstarService } from "@/lib/risk/lstar-service";

beforeEach(() => {
  history.mockReset().mockResolvedValue({
    rows: [],
    dataSource: "zarr",
    historyStarts: { CRWV: "2025-03-28" },
  });
});

describe("empty historical service responses", () => {
  it("adds the first available date to L3 decomposition", async () => {
    const result = await new L3DecompositionService().getDecomposition("CRWV");

    expect(result).toMatchObject({ dates: [], history_starts: "2025-03-28" });
    expect(toL3DecompositionPublicBody(result!)).toMatchObject({
      history_starts: "2025-03-28",
    });
  });

  it("adds the first available date to returns decomposition", async () => {
    const result = await new ReturnsDecompositionService().getDecomposition("CRWV");

    expect(result).toMatchObject({ dates: [], history_starts: "2025-03-28" });
    expect(toReturnsDecompositionPublicBody(result!)).toMatchObject({
      history_starts: "2025-03-28",
    });
  });

  it("adds the first available date to Lstar", async () => {
    const result = await new LstarService().getLstar("CRWV");

    expect(result).toMatchObject({ dates: [], history_starts: "2025-03-28" });
  });
});
