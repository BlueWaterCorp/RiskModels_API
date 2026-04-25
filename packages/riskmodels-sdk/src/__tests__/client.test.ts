import { describe, expect, it, vi } from "vitest";
import { RiskModelsClient } from "../index";
import type { FetchLike, RiskModelsResult } from "../index";

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function expectContract(result: RiskModelsResult): void {
  expect(result.raw).toBeDefined();
  expect(result.normalized.components.length).toBeGreaterThan(0);
  expect(result.chart_data.length).toBeGreaterThan(0);
  expect(result.suggested_chart).toBeDefined();
  expect(result.plain_english.length).toBeGreaterThan(20);
  expect(result.api_call.path).toMatch(/^\/.+/);
  expect(result.api_call.curl).toContain("$RISKMODELS_API_KEY");
  expect(result.api_call.curl).not.toContain("sk-test");
}

describe("RiskModelsClient", () => {
  it("normalizes decompose responses into a chart-ready result", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        {
          ticker: "NVDA",
          exposure: {
            market: { er: 0.31, hr: -0.12, hedge_etf: "SPY" },
            sector: { er: 0.24, hr: 0.18, hedge_etf: "XLK" },
            subsector: { er: 0.21, hr: 0.42, hedge_etf: "SOXX" },
            residual: { er: 0.24, hr: null, hedge_etf: null },
          },
          hedge: { SPY: 0.12, XLK: -0.18, SOXX: -0.42 },
          _metadata: { data_as_of: "2026-04-24" },
        },
        { "X-Request-ID": "req_123" },
      ),
    );

    const client = new RiskModelsClient({ apiKey: "sk-test", fetch: fetchMock });
    const result = await client.decompose("nvda");

    expectContract(result);
    expect(result.normalized.ticker).toBe("NVDA");
    expect(result.suggested_chart).toBe("bar");
    expect(result.chart_data.map((datum) => datum.layer)).toEqual([
      "market",
      "sector",
      "subsector",
      "residual",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
  });

  it("normalizes batch comparison results as grouped chart data", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        results: {
          AAPL: {
            status: "success",
            ticker: "AAPL",
            full_metrics: {
              l3_mkt_er: 0.28,
              l3_sec_er: 0.22,
              l3_sub_er: 0.14,
              l3_res_er: 0.36,
              l3_mkt_hr: 0.4,
              l3_sec_hr: 0.2,
              l3_sub_hr: 0.1,
            },
            meta: { sector_etf: "XLK", subsector_etf: "VGT" },
          },
          NVDA: {
            status: "success",
            ticker: "NVDA",
            full_metrics: {
              l3_mkt_er: 0.18,
              l3_sec_er: 0.16,
              l3_sub_er: 0.42,
              l3_res_er: 0.24,
              l3_mkt_hr: -0.1,
              l3_sec_hr: 0.3,
              l3_sub_hr: 0.8,
            },
            meta: { sector_etf: "XLK", subsector_etf: "SOXX" },
          },
        },
      }),
    );

    const client = new RiskModelsClient({ apiKey: "sk-test", fetch: fetchMock });
    const result = await client.compare(["AAPL", "NVDA"]);

    expectContract(result);
    expect(result.suggested_chart).toBe("grouped_bar");
    expect(result.normalized.tickers).toEqual(["AAPL", "NVDA"]);
    expect(result.chart_data).toHaveLength(8);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("full_metrics");
  });

  it("scales hedge ratios into position-level hedge notionals", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ticker: "NVDA",
        exposure: {
          market: { er: 0.2, hr: -0.1, hedge_etf: "SPY" },
          sector: { er: 0.2, hr: 0.3, hedge_etf: "XLK" },
          subsector: { er: 0.4, hr: 0.6, hedge_etf: "SOXX" },
          residual: { er: 0.2, hr: null, hedge_etf: null },
        },
      }),
    );

    const client = new RiskModelsClient({ fetch: fetchMock });
    const result = await client.hedgePosition({ ticker: "NVDA", dollars: 10_000 });

    expectContract(result);
    expect(result.chart_data.map((datum) => datum.metric)).toEqual([
      "hedge_notional",
      "hedge_notional",
      "hedge_notional",
    ]);
    expect(result.chart_data.map((datum) => datum.value)).toEqual([1_000, -3_000, -6_000]);
  });

  it("normalizes portfolio risk snapshot responses", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        portfolio_risk_index: {
          variance_decomposition: {
            market: 0.3,
            sector: 0.2,
            subsector: 0.1,
            residual: 0.4,
          },
        },
      }),
    );

    const client = new RiskModelsClient({ fetch: fetchMock });
    const result = await client.portfolioDecompose([
      { ticker: "AAPL", weight: 0.5 },
      { ticker: "NVDA", weight: 0.5 },
    ]);

    expectContract(result);
    expect(result.normalized.portfolio).toBeDefined();
    expect(result.api_call.path).toBe("/portfolio/risk-snapshot");
  });

  it("embeds whitepaper context around live example results", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        results: {
          AAPL: {
            status: "success",
            ticker: "AAPL",
            full_metrics: { l3_mkt_er: 0.3, l3_sec_er: 0.2, l3_sub_er: 0.1, l3_res_er: 0.4 },
            meta: { sector_etf: "XLK", subsector_etf: "VGT" },
          },
          NVDA: {
            status: "success",
            ticker: "NVDA",
            full_metrics: { l3_mkt_er: 0.2, l3_sec_er: 0.2, l3_sub_er: 0.4, l3_res_er: 0.2 },
            meta: { sector_etf: "XLK", subsector_etf: "SOXX" },
          },
        },
      }),
    );

    const client = new RiskModelsClient({ fetch: fetchMock });
    const result = await client.whitepaperExample("aapl-vs-nvda");

    expectContract(result);
    expect(result.example_id).toBe("aapl-vs-nvda");
    expect(result.chapter_uri).toBe("riskmodels://whitepaper/chapter/02-aapl-vs-nvda");
    expect(result.prompt_to_try).toContain("AAPL and NVDA");
  });
});
