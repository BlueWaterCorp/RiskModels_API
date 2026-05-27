import { describe, expect, it } from "vitest";

import { BatchLstarRequestSchema } from "@/lib/api/schemas";
import {
  batchLstarToLongRows,
  type BatchLstarResponseBody,
} from "@/lib/risk/batch-lstar-service";

describe("BatchLstarRequestSchema", () => {
  it("accepts tickers, threshold, and format", () => {
    const parsed = BatchLstarRequestSchema.parse({
      tickers: ["NVDA", "AAPL"],
      years: "2",
      threshold: "0.015",
      format: "parquet",
    });
    expect(parsed.tickers).toEqual(["NVDA", "AAPL"]);
    expect(parsed.years).toBe(2);
    expect(parsed.threshold).toBe(0.015);
    expect(parsed.format).toBe("parquet");
  });

  it("rejects empty tickers array", () => {
    const result = BatchLstarRequestSchema.safeParse({ tickers: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 100 tickers", () => {
    const tickers = Array.from({ length: 101 }, (_, i) => `T${i}`);
    const result = BatchLstarRequestSchema.safeParse({ tickers });
    expect(result.success).toBe(false);
  });
});

describe("batchLstarToLongRows", () => {
  it("expands successful tickers to long rows", () => {
    const body: BatchLstarResponseBody = {
      results: {
        NVDA: {
          ticker: "NVDA",
          status: "success",
          dates: ["2026-05-01", "2026-05-02"],
          lstar: ["L3", "L2"],
          market_hr: [-0.9, -0.8],
          sector_hr: [0.1, 0.2],
          subsector_hr: [0.05, null],
          total_er: [0.6, 0.5],
          residual_return: [0.01, -0.02],
          l2_sector_er: [0.2, 0.18],
          l3_subsector_er: [0.15, 0.12],
          threshold_used: 0.01,
          market_factor_etf: "SPY",
          universe: "US_EQUITY",
          data_source: "zarr",
        },
        BAD: {
          ticker: "BAD",
          status: "not_found",
        },
      },
      summary: { total: 2, success: 1, errors: 0, not_found: 1 },
      years: 1,
      threshold_used: 0.01,
      market_factor_etf: "SPY",
    };

    const rows = batchLstarToLongRows(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ticker: "NVDA",
      date: "2026-05-01",
      lstar: "L3",
      residual_return: 0.01,
    });
  });
});
