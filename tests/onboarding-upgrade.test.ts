import { describe, expect, it } from "vitest";
import { buildInstallPlans, defaultMcpServerConfig, firstPrompt } from "../cli/src/lib/mcp-install-plan";
import { selectedClients, type ClientDetection } from "../cli/src/lib/mcp-config-paths";
import { redactJson, redactSecret } from "../cli/src/lib/redact";
import { normalizeCompareResult, normalizeDecomposeResult, normalizeHedgePositionResult } from "../packages/riskmodels-sdk/src/normalize";
import { registerRiskModelsTools } from "../lib/mcp/tools/riskmodels-tools";

const apiCall = {
  method: "POST" as const,
  path: "/decompose",
  base_url: "https://riskmodels.app/api",
  curl: 'curl -X POST "https://riskmodels.app/api/decompose" -H "Authorization: Bearer $RISKMODELS_API_KEY"',
};

describe("RiskModels onboarding response contracts", () => {
  it("normalizes single-stock decompositions into chart-ready bar data", () => {
    const result = normalizeDecomposeResult(
      {
        ticker: "NVDA",
        exposure: {
          market: { er: 0.42, hr: 1.05, hedge_etf: "SPY" },
          sector: { er: 0.18, hr: 0.32, hedge_etf: "XLK" },
          subsector: { er: 0.12, hr: 0.58, hedge_etf: "SMH" },
          residual: { er: 0.28, hr: null, hedge_etf: null },
        },
        hedge: { SPY: -1.05, XLK: -0.32, SMH: -0.58 },
        _metadata: { data_as_of: "2026-04-22" },
      },
      apiCall,
    );

    expect(result.normalized.ticker).toBe("NVDA");
    expect(result.normalized.components).toHaveLength(4);
    expect(result.chart_data).toHaveLength(4);
    expect(result.chart_data[0]).toMatchObject({
      label: "Market",
      ticker: "NVDA",
      layer: "market",
      metric: "explained_risk",
      unit: "fraction",
      value: 0.42,
    });
    expect(result.suggested_chart).toBe("bar");
    expect(result.plain_english).toContain("NVDA");
    expect(result.api_call.data_as_of).toBe("2026-04-22");
  });

  it("normalizes comparisons into grouped bar chart data", () => {
    const result = normalizeCompareResult(
      {
        results: {
          AAPL: {
            ticker: "AAPL",
            full_metrics: { l3_mkt_er: 0.5, l3_sec_er: 0.1, l3_sub_er: 0.05, l3_res_er: 0.35 },
            meta: { sector_etf: "XLK", subsector_etf: "XLC" },
          },
          NVDA: {
            ticker: "NVDA",
            full_metrics: { l3_mkt_er: 0.42, l3_sec_er: 0.18, l3_sub_er: 0.12, l3_res_er: 0.28 },
            meta: { sector_etf: "XLK", subsector_etf: "SMH" },
          },
        },
      },
      { ...apiCall, path: "/batch/analyze" },
    );

    expect(result.normalized.tickers).toEqual(["AAPL", "NVDA"]);
    expect(result.chart_data).toHaveLength(8);
    expect(result.suggested_chart).toBe("grouped_bar");
    expect(result.plain_english).toContain("Compared AAPL, NVDA");
  });

  it("scales hedge notionals without charting the residual layer", () => {
    const result = normalizeHedgePositionResult(
      {
        ticker: "NVDA",
        exposure: {
          market: { er: 0.42, hr: 1.05, hedge_etf: "SPY" },
          sector: { er: 0.18, hr: 0.32, hedge_etf: "XLK" },
          subsector: { er: 0.12, hr: 0.58, hedge_etf: "SMH" },
          residual: { er: 0.28, hr: null, hedge_etf: null },
        },
      },
      apiCall,
      10000,
    );

    expect(result.chart_data).toHaveLength(3);
    expect(result.chart_data.map((datum) => datum.metric)).toEqual([
      "hedge_notional",
      "hedge_notional",
      "hedge_notional",
    ]);
    expect(result.chart_data[0].value).toBe(-10500);
    expect(result.plain_english).toContain("$10,000");
  });
});

describe("RiskModels CLI installer planning", () => {
  const detections: ClientDetection[] = [
    {
      client: "cursor",
      label: "Cursor",
      mode: "auto-write",
      status: "found",
      configPath: "/tmp/.cursor/mcp.json",
      notes: ["Global Cursor MCP config exists."],
    },
  ];

  it("defaults to @riskmodels/mcp without embedding secrets", () => {
    expect(defaultMcpServerConfig("rm_agent_live_secret")).toEqual({
      command: "npx",
      args: ["-y", "@riskmodels/mcp"],
    });
  });

  it("redacts explicitly embedded API keys in dry-run plans", () => {
    const plans = buildInstallPlans(detections, {
      apiKey: "rm_agent_live_abcdefghijklmnopqrstuvwxyz",
      embedKey: true,
    });

    expect(plans[0].mcpServer).toEqual({
      command: "npx",
      args: ["-y", "@riskmodels/mcp"],
      env: { RISKMODELS_API_KEY: "rm_age...wxyz" },
    });
  });

  it("validates selected clients and first prompt copy", () => {
    expect(selectedClients({ client: "cursor" })).toEqual(["cursor"]);
    expect(selectedClients({ all: true })).toEqual(["claude", "cursor", "codex", "vscode"]);
    expect(() => selectedClients({ client: "zed" })).toThrow("Unknown client");
    expect(firstPrompt()).toBe("Compare AAPL and NVDA using RiskModels. What am I really betting on?");
  });

  it("redacts nested secret-shaped keys", () => {
    expect(redactSecret("rm_agent_live_abcdefghijklmnopqrstuvwxyz")).toBe("rm_age...wxyz");
    expect(redactJson({ env: { RISKMODELS_API_KEY: "rm_agent_live_abcdefghijklmnopqrstuvwxyz" } })).toEqual({
      env: { RISKMODELS_API_KEY: "rm_age...wxyz" },
    });
  });
});

describe("RiskModels MCP live-paper tools", () => {
  it("registers SDK-backed tools and injects chart instructions", async () => {
    const tools = new Map<string, (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>>();
    const server = {
      registerTool: (name: string, _config: Record<string, unknown>, handler: any) => {
        tools.set(name, handler);
      },
      registerResource: () => undefined,
    };
    const sdk = {
      decompose: async () => ({
        raw: {},
        normalized: { components: [] },
        chart_data: [{ label: "Market", metric: "explained_risk", value: 0.42, unit: "fraction" }],
        suggested_chart: "bar",
        plain_english: "NVDA is primarily a market bet.",
        api_call: apiCall,
      }),
      compare: async () => ({}),
      hedgePosition: async () => ({}),
      portfolioDecompose: async () => ({}),
      whitepaperExample: async () => ({}),
    };

    registerRiskModelsTools(sdk as any, server as any);

    expect([...tools.keys()]).toEqual([
      "riskmodels_decompose",
      "riskmodels_compare",
      "riskmodels_hedge_position",
      "riskmodels_portfolio_decompose",
      "riskmodels_whitepaper_example",
    ]);

    const result = await tools.get("riskmodels_decompose")?.({ ticker: "NVDA" });
    const payload = JSON.parse(result?.content[0].text ?? "{}");
    expect(payload.chart_instruction).toContain("render the suggested_chart");
    expect(payload.chart_instruction).toContain("grouped bars for comparisons");
    expect(payload.chart_data).toHaveLength(1);
  });
});
