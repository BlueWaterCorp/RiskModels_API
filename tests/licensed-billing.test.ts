import { describe, expect, it } from "vitest";
import { extractRequestFacets } from "@/lib/agent/request-facets";
import {
  licensedTelemetryMetadata,
  shouldSkipCharge,
} from "@/lib/agent/licensed-billing";

describe("extractRequestFacets", () => {
  it("reads a ticker from GET /metrics/{ticker}", () => {
    const f = extractRequestFacets({
      url: "https://riskmodels.app/api/metrics/NVDA",
    });
    expect(f.tickers).toEqual(["NVDA"]);
    expect(f.item_count).toBe(1);
  });

  it("reads tickers query and years", () => {
    const f = extractRequestFacets({
      url: "https://riskmodels.app/api/ticker-returns?tickers=AAPL,MSFT&years=5&as_of=2026-08-14",
    });
    expect(f.tickers).toEqual(["AAPL", "MSFT"]);
    expect(f.years).toBe(5);
    expect(f.as_of).toBe("2026-08-14");
    expect(f.item_count).toBe(2);
  });

  it("reads positions from a batch body", () => {
    const f = extractRequestFacets({
      url: "https://riskmodels.app/api/batch/analyze",
      body: {
        positions: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "NVDA", weight: 0.5 }],
      },
    });
    expect(f.tickers).toEqual(["AAPL", "NVDA"]);
    expect(f.item_count).toBe(2);
  });

  it("caps ticker lists at 50", () => {
    const tickers = Array.from({ length: 80 }, (_, i) => `T${i}`);
    const f = extractRequestFacets({
      url: "https://riskmodels.app/api/batch/analyze",
      body: { tickers },
    });
    expect(f.tickers).toHaveLength(50);
    expect(f.item_count).toBe(80);
  });
});

describe("shouldSkipCharge", () => {
  it("skips for licensed billing_mode", () => {
    expect(shouldSkipCharge({ billingMode: "licensed" })).toBe(true);
  });

  it("skips for first-party gateway unlimited", () => {
    expect(shouldSkipCharge({ internalUnlimited: true, billingMode: "prepaid" })).toBe(
      true,
    );
  });

  it("does not skip prepaid", () => {
    expect(shouldSkipCharge({ billingMode: "prepaid" })).toBe(false);
    expect(shouldSkipCharge({})).toBe(false);
  });
});

describe("licensedTelemetryMetadata", () => {
  it("stores list_price_usd on licensed rows without putting it in cost_usd", () => {
    const meta = licensedTelemetryMetadata({
      billingMode: "licensed",
      licenseTier: "firm",
      listPriceUsd: 0.005,
      keyId: "key-1",
      keyPrefix: "rm_agent_live_ab",
      originalUrl: "https://riskmodels.app/api/metrics/AAPL",
      facets: {
        tickers: ["AAPL"],
        item_count: 1,
        as_of: null,
        years: null,
      },
    });
    expect(meta.billing_mode).toBe("licensed");
    expect(meta.license_tier).toBe("firm");
    expect(meta.list_price_usd).toBe(0.005);
    expect(meta.tickers).toEqual(["AAPL"]);
    expect(meta.key_id).toBe("key-1");
  });

  it("does not attach license fields on prepaid", () => {
    const meta = licensedTelemetryMetadata({
      billingMode: "prepaid",
      licenseTier: null,
      listPriceUsd: 0.005,
      originalUrl: "https://riskmodels.app/api/metrics/AAPL",
      facets: { tickers: ["AAPL"], item_count: 1, as_of: null, years: null },
      extra: { fetch_latency_ms: 12 },
    });
    expect(meta.billing_mode).toBeUndefined();
    expect(meta.list_price_usd).toBeUndefined();
    expect(meta.fetch_latency_ms).toBe(12);
  });
});
