import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildInstallPlans, defaultMcpServerConfig, firstPrompt } from "../cli/src/lib/mcp-install-plan";
import { FIRST_LIVE_PROMPT_MCP, FIRST_LIVE_PROMPT_REST, MCP_SERVER_INSTRUCTIONS } from "../lib/mcp/activation";
import { buildLlmsTxt } from "../lib/llms-txt";
import { selectedClients, type ClientDetection } from "../cli/src/lib/mcp-config-paths";
import { redactJson, redactSecret } from "../cli/src/lib/redact";
import {
  mergeCodexTomlConfig,
  mergeJsonMcpConfig,
  removeCodexTomlConfig,
  removeJsonMcpConfig,
} from "../cli/src/lib/mcp-config-writer";
import { normalizeCompareResult, normalizeDecomposeResult, normalizeHedgePositionResult } from "../packages/riskmodels-sdk/src/normalize";
import { registerRiskModelsTools, registerRiskModelsPrompts } from "../lib/mcp/tools/riskmodels-tools";

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
      transport: "local",
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
    expect(firstPrompt()).toBe(FIRST_LIVE_PROMPT_MCP);
    expect(firstPrompt()).toContain("riskmodels_compare");
    expect(firstPrompt()).toContain("riskmodels_decompose");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Skip riskmodels_list_endpoints");
    const llms = buildLlmsTxt("https://riskmodels.app");
    expect(llms).toContain(FIRST_LIVE_PROMPT_MCP);
    expect(llms).toContain(FIRST_LIVE_PROMPT_REST);
    expect(llms).toContain("Do not start with a capability catalog");
    const mdx = readFileSync(join(__dirname, "../content/docs/agent-integration.mdx"), "utf8");
    expect(mdx).toContain(FIRST_LIVE_PROMPT_MCP);
    expect(mdx).toContain(FIRST_LIVE_PROMPT_REST);
  });

  it("redacts nested secret-shaped keys", () => {
    expect(redactSecret("rm_agent_live_abcdefghijklmnopqrstuvwxyz")).toBe("rm_age...wxyz");
    expect(redactJson({ env: { RISKMODELS_API_KEY: "rm_agent_live_abcdefghijklmnopqrstuvwxyz" } })).toEqual({
      env: { RISKMODELS_API_KEY: "rm_age...wxyz" },
    });
  });

  it("merges and removes JSON MCP config without overwriting other servers", () => {
    const merged = mergeJsonMcpConfig(
      JSON.stringify({
        mcpServers: {
          existing: { command: "node", args: ["server.js"] },
        },
      }),
      defaultMcpServerConfig(),
    );

    expect(JSON.parse(merged)).toEqual({
      mcpServers: {
        existing: { command: "node", args: ["server.js"] },
        riskmodels: { command: "npx", args: ["-y", "@riskmodels/mcp"] },
      },
    });

    const removed = removeJsonMcpConfig(merged);
    expect(removed.removed).toBe(true);
    expect(JSON.parse(removed.text)).toEqual({
      mcpServers: {
        existing: { command: "node", args: ["server.js"] },
      },
    });
  });

  it("merges and removes managed Codex TOML blocks", () => {
    const merged = mergeCodexTomlConfig(
      `[profile]\nname = "default"\n`,
      defaultMcpServerConfig("rm_agent_live_abcdefghijklmnopqrstuvwxyz", true),
    );

    expect(merged).toContain("[profile]");
    expect(merged).toContain("[mcp_servers.riskmodels]");
    expect(merged).toContain('args = ["-y", "@riskmodels/mcp"]');
    expect(merged).toContain("[mcp_servers.riskmodels.env]");
    expect(merged).toContain('RISKMODELS_API_KEY = "rm_agent_live_abcdefghijklmnopqrstuvwxyz"');

    const removed = removeCodexTomlConfig(merged);
    expect(removed.removed).toBe(true);
    expect(removed.text).toBe(`[profile]\nname = "default"\n`);
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
      getHedgeLevels: async () => ({}),
      compare: async () => ({}),
      hedgePosition: async () => ({}),
      analyzePortfolio: async () => ({}),
      hedgePortfolio: async () => ({}),
      portfolioDecompose: async () => ({}),
      whitepaperExample: async () => ({}),
    };

    registerRiskModelsTools(sdk as any, server as any);

    expect([...tools.keys()]).toEqual([
      "riskmodels_decompose",
      "riskmodels_get_returns",
      "riskmodels_get_return_attribution",
      "riskmodels_get_lstar",
      "riskmodels_batch_lstar",
      "riskmodels_get_hedge_levels",
      "riskmodels_compare",
      "riskmodels_hedge_position",
      "riskmodels_analyze_portfolio",
      "riskmodels_hedge_portfolio",
      "riskmodels_portfolio_decompose",
      "riskmodels_whitepaper_example",
      "riskmodels_search_tickers",
      "riskmodels_search_filers",
      "riskmodels_search_etfs",
      "riskmodels_get_rankings",
      "riskmodels_get_fundamentals",
      "riskmodels_screen_rankings",
      "riskmodels_get_macro_correlation",
      "riskmodels_get_residual_signal",
      "riskmodels_get_filer_snapshot",
      "riskmodels_get_filer_holdings",
      "riskmodels_get_etf",
      "riskmodels_get_etf_holdings",
      "riskmodels_get_benchmark_fit",
      "riskmodels_call_endpoint",
    ]);
    // riskmodels_render_artifact is hosted-only — registered separately via
    // registerRiskModelsRenderTool (needs GCP Cloud Run auth), intentionally
    // NOT in the shared/stdio tool set.

    const result = await tools.get("riskmodels_decompose")?.({ ticker: "NVDA" });
    const payload = JSON.parse(result?.content[0].text ?? "{}");
    expect(payload.chart_instruction).toContain("render the suggested_chart");
    expect(payload.chart_instruction).toContain("grouped bars for comparisons");
    expect(payload.chart_data).toHaveLength(1);
  });

  it("passthrough allowlists registered capabilities and is traversal-safe", async () => {
    const tools = new Map<string, (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>>();
    const server = {
      registerTool: (name: string, _c: any, h: any) => tools.set(name, h),
      registerResource: () => undefined,
    };
    const calls: Array<{ method: string; path: string }> = [];
    const sdk = {
      decompose: async () => ({}),
      getHedgeLevels: async () => ({}),
      compare: async () => ({}),
      hedgePosition: async () => ({}),
      analyzePortfolio: async () => ({}),
      hedgePortfolio: async () => ({}),
      portfolioDecompose: async () => ({}),
      whitepaperExample: async () => ({}),
      getReturns: async () => ({}),
      getReturnAttribution: async () => ({}),
      call: async (method: string, path: string) => {
        calls.push({ method, path });
        return { ok: true };
      },
    };
    registerRiskModelsTools(sdk as any, server as any, {
      capabilities: [
        { id: "rankings", method: "GET", endpoint: "/api/rankings/{ticker}" },
        { id: "cli-query", method: "POST", endpoint: "/api/cli/query" }, // blocked → excluded from allowlist
      ],
    });
    const passthrough = tools.get("riskmodels_call_endpoint")!;

    // Allowed registered capability dispatches with the normalized path.
    await passthrough({ method: "GET", path: "/api/rankings/NVDA" });
    expect(calls).toEqual([{ method: "GET", path: "/rankings/NVDA" }]);

    // Blocked capability rejected — even via path traversal that would normalize
    // to it downstream (the bug this guards against).
    for (const p of ["/cli/query", "/x/../cli/query", "/api/x/%2e%2e/cli/query", "/internal/secret"]) {
      const r = await passthrough({ method: "POST", path: p, body: { sql: "select 1" } });
      expect(r.content[0].text).toContain("not an invocable capability");
    }
    // Only the single allowed call ever dispatched.
    expect(calls).toHaveLength(1);
  });

  it("registers first_live_call as the first MCP prompt", () => {
    const prompts = new Map<string, () => { messages: Array<{ content: { text: string } }> }>();
    const server = {
      registerTool: () => undefined,
      registerResource: () => undefined,
      registerPrompt: (name: string, _config: Record<string, unknown>, handler: any) => {
        prompts.set(name, handler);
      },
    };
    registerRiskModelsPrompts(server as any);
    expect([...prompts.keys()][0]).toBe("first_live_call");
    const body = prompts.get("first_live_call")!().messages[0].content.text;
    expect(body).toContain("riskmodels_compare");
    expect(body).toContain("riskmodels_decompose");
    expect(body).toContain("Do not call riskmodels_list_endpoints");
  });
});
