import { describe, expect, it } from "vitest";

import { createMcpServer as createHostedServer } from "@/lib/mcp/server";
import { createMcpServer as createNpmServer } from "../mcp/src/server";
import {
  HOSTED_ONLY_TOOL_NAMES,
  RISKMODELS_TOOL_NAMES,
  registerRiskModelsTools,
} from "@/lib/mcp/tools/riskmodels-tools";
import { RiskModelsClient } from "../packages/riskmodels-sdk/src/client";

/**
 * MCP tool set 2.0: one registry for all three surfaces.
 * - npm stdio (`mcp/src/server.ts`): the 25 shared tools;
 * - hosted `/api/mcp/sse` and `/api/mcp/openai` (`lib/mcp/server.ts`): the
 *   same 25 plus riskmodels_render_artifact.
 * The routing test drives every shared tool through a real RiskModelsClient
 * with a stubbed fetch and pins the REST method + path each one calls.
 */

const NPM_TOOLS = [
  "riskmodels_analyze_portfolio",
  "riskmodels_compare",
  "riskmodels_decompose",
  "riskmodels_decompose_selection_vs_drift",
  "riskmodels_get_benchmark_fit",
  "riskmodels_get_cohorts",
  "riskmodels_get_etf",
  "riskmodels_get_factor_returns",
  "riskmodels_get_filer",
  "riskmodels_get_fund",
  "riskmodels_get_fundamentals",
  "riskmodels_get_macro_correlation",
  "riskmodels_get_my_positions",
  "riskmodels_get_peers",
  "riskmodels_get_portfolio_risk_snapshot",
  "riskmodels_get_rankings",
  "riskmodels_get_residual_returns",
  "riskmodels_get_residual_signal",
  "riskmodels_get_return_attribution",
  "riskmodels_get_returns",
  "riskmodels_get_risk_history",
  "riskmodels_get_stock_snapshot",
  "riskmodels_portfolio_exposure",
  "riskmodels_screen_rankings",
  "riskmodels_search",
];

const HOSTED_TOOLS = [...NPM_TOOLS, "riskmodels_render_artifact"].sort();

function toolNames(server: unknown): string[] {
  return Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
}

describe("MCP tool set 2.0 surfaces", () => {
  it("npm stdio server registers exactly the 25 shared tools", () => {
    const server = createNpmServer({ apiKey: "rm_agent_live_test", apiBase: "https://riskmodels.test" });
    expect(toolNames(server)).toEqual(NPM_TOOLS);
  });

  it("hosted /api/mcp/sse registers the 25 shared tools plus the render tool", () => {
    expect(toolNames(createHostedServer({ apiKey: "rm_agent_live_test", surface: "default" }))).toEqual(HOSTED_TOOLS);
  });

  it("hosted /api/mcp/openai registers the same 26 tools", () => {
    expect(toolNames(createHostedServer({ apiKey: "rm_agent_live_test", surface: "openai" }))).toEqual(HOSTED_TOOLS);
  });

  it("the exported name lists match the registrations", () => {
    expect([...RISKMODELS_TOOL_NAMES].sort()).toEqual(NPM_TOOLS);
    expect([...HOSTED_ONLY_TOOL_NAMES]).toEqual(["riskmodels_render_artifact"]);
  });

  it("npm and hosted servers share titles, descriptions and input schemas", () => {
    type T = { title?: string; description?: string; inputSchema?: { shape?: Record<string, unknown> } };
    const npm = (createNpmServer({ apiKey: "k", apiBase: "https://riskmodels.test" }) as unknown as {
      _registeredTools: Record<string, T>;
    })._registeredTools;
    const hosted = (createHostedServer({ apiKey: "k" }) as unknown as { _registeredTools: Record<string, T> })
      ._registeredTools;
    for (const name of NPM_TOOLS) {
      expect(npm[name]!.title, name).toBe(hosted[name]!.title);
      expect(npm[name]!.description, name).toBe(hosted[name]!.description);
      expect(Object.keys(npm[name]!.inputSchema?.shape ?? {}), name).toEqual(
        Object.keys(hosted[name]!.inputSchema?.shape ?? {}),
      );
    }
  });
});

type Call = { method: string; path: string; query: Record<string, string>; body?: unknown };

function harness(failPaths: string[] = []) {
  const calls: Call[] = [];
  const stubFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.origin === "https://portal.test" ? `portal:${url.pathname}` : url.pathname.replace(/^\/api/, ""),
      query: Object.fromEntries(url.searchParams.entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (failPaths.includes(calls[calls.length - 1]!.path)) {
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    }
    return new Response(JSON.stringify({ ticker: "NVDA", results: {}, positions: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const sdk = new RiskModelsClient({ apiKey: "rm_agent_live_test", baseUrl: "https://rm.test/api", fetch: stubFetch });
  const handlers = new Map<string, (args: any) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>>();
  registerRiskModelsTools(
    sdk,
    {
      registerTool: (name: string, _config: unknown, handler: any) => handlers.set(name, handler),
      registerResource: () => undefined,
    } as never,
    { apiKey: "rm_agent_live_test", portalBase: "https://portal.test", fetchPositions: stubFetch as typeof fetch },
  );
  const run = async (tool: string, args: Record<string, unknown>): Promise<Call[]> => {
    const before = calls.length;
    const handler = handlers.get(tool);
    if (!handler) throw new Error(`no tool ${tool}`);
    const result = await handler(args);
    expect(result.isError, `${tool} ${result.content[0]?.text ?? ""}`).toBeFalsy();
    return calls.slice(before);
  };
  return { run, handlers };
}

const routes = (cs: Call[]) => cs.map((c) => `${c.method} ${c.path}`);

describe("MCP tool routing (method + REST path)", () => {
  const { run, handlers } = harness();
  const exercised = new Set<string>();
  const r = async (tool: string, args: Record<string, unknown>) => {
    exercised.add(tool);
    return run(tool, args);
  };

  it("single-stock tools", async () => {
    expect(routes(await r("riskmodels_get_stock_snapshot", { ticker: "nvda" }))).toEqual(["GET /metrics/NVDA"]);
    expect(
      routes(await r("riskmodels_get_stock_snapshot", { ticker: "nvda", include: ["rankings", "peers", "fundamentals"] })),
    ).toEqual(["GET /metrics/NVDA", "GET /rankings/NVDA", "GET /peers", "GET /fundamentals/NVDA"]);

    const dec = await r("riskmodels_decompose", { ticker: "nvda" });
    expect(routes(dec)).toEqual(["POST /decompose"]);
    expect(dec[0]!.body).toEqual({ ticker: "NVDA" });
    const hedge = await r("riskmodels_decompose", { ticker: "nvda", dollars: 10000 });
    expect(routes(hedge)).toEqual(["POST /decompose"]);
    expect(hedge[0]!.body).toEqual({ ticker: "NVDA" });

    const cmp = await r("riskmodels_compare", { tickers: ["AAPL", "NVDA"] });
    expect(routes(cmp)).toEqual(["POST /batch/analyze"]);
    expect(cmp[0]!.body).toMatchObject({ tickers: ["AAPL", "NVDA"], metrics: ["full_metrics", "hedge_ratios"] });

    expect(routes(await r("riskmodels_get_returns", { ticker: "AAPL", years: 2 }))).toEqual(["GET /ticker-returns"]);

    const hist = await r("riskmodels_get_risk_history", { ticker: "nvda" });
    expect(routes(hist)).toEqual(["GET /l3-decomposition"]);
    expect(hist[0]!.query).toEqual({ ticker: "NVDA", market_factor_etf: "SPY", years: "1" });

    expect(routes(await r("riskmodels_get_return_attribution", { ticker: "AAPL", include_lstar: true }))).toEqual([
      "GET /returns-decomposition",
    ]);
    expect(routes(await r("riskmodels_get_residual_signal", { tickers: ["aapl", "msft"] }))).toEqual([
      "POST /signals/residual-reversion/basket",
    ]);
    expect(routes(await r("riskmodels_get_macro_correlation", { ticker: "nvda" }))).toEqual(["POST /correlation"]);
    expect(routes(await r("riskmodels_get_fundamentals", { ticker: "aapl", periods: 4 }))).toEqual([
      "GET /fundamentals/AAPL",
    ]);
  });

  it("residual returns: one ticker uses GET /lstar, several (or csv/parquet) use POST /batch/lstar", async () => {
    const one = await r("riskmodels_get_residual_returns", { tickers: ["nvda"], years: 2, axis: "industry" });
    expect(routes(one)).toEqual(["GET /lstar"]);
    expect(one[0]!.query).toEqual({ ticker: "NVDA", years: "2", axis: "industry" });

    const many = await r("riskmodels_get_residual_returns", { tickers: ["aapl", "msft"], years: 3 });
    expect(routes(many)).toEqual(["POST /batch/lstar"]);
    expect(many[0]!.body).toEqual({ tickers: ["AAPL", "MSFT"], years: 3 });

    const csv = await r("riskmodels_get_residual_returns", { tickers: ["nvda"], format: "csv" });
    expect(routes(csv)).toEqual(["POST /batch/lstar"]);
    expect(csv[0]!.body).toEqual({ tickers: ["NVDA"], format: "csv" });
  });

  it("portfolio tools", async () => {
    const weights = await r("riskmodels_analyze_portfolio", {
      positions: [
        { ticker: "AAPL", weight: 0.6 },
        { ticker: "NVDA", weight: 0.4 },
      ],
    });
    expect(routes(weights)).toEqual(["POST /batch/analyze"]);
    const dollars = await r("riskmodels_analyze_portfolio", {
      positions: [
        { ticker: "AAPL", dollars: 60000 },
        { ticker: "NVDA", dollars: 40000 },
      ],
      level: "L2",
    });
    expect(routes(dollars)).toEqual(["POST /batch/analyze"]);
    // Same request body either way: the hedge view is computed from the same response.
    expect(dollars[0]!.body).toEqual(weights[0]!.body);
    expect(weights[0]!.body).toEqual({ tickers: ["AAPL", "NVDA"], metrics: ["hedge_ratios"], years: 1, format: "json" });
    const withIndex = await r("riskmodels_analyze_portfolio", {
      positions: [{ ticker: "aapl", dollars: 100 }],
      include: ["risk_index"],
    });
    expect(routes(withIndex)).toEqual(["POST /batch/analyze", "POST /portfolio/risk-index"]);
    expect(withIndex[1]!.body).toEqual({ positions: [{ ticker: "AAPL", weight: 100 }] });

    const snap = await r("riskmodels_get_portfolio_risk_snapshot", {
      positions: [
        { ticker: "aapl", weight: 0.4 },
        { ticker: "NVDA", dollars: 35 },
      ],
    });
    expect(routes(snap)).toEqual(["POST /portfolio/risk-snapshot"]);
    expect(snap[0]!.body).toEqual({
      format: "json",
      positions: [
        { ticker: "AAPL", weight: 0.4 },
        { ticker: "NVDA", weight: 35 },
      ],
    });

    const withReturns = await r("riskmodels_get_portfolio_risk_snapshot", {
      positions: [{ ticker: "AAPL", shares: 10 }],
      include_returns: true,
      benchmark: "SPY",
    });
    expect(routes(withReturns)).toEqual(["POST /snapshot"]);
    expect(withReturns[0]!.body).toEqual({
      type: "portfolio",
      portfolio: [{ ticker: "AAPL", shares: 10 }],
      lookback_days: 252,
      benchmark: "SPY",
    });

    expect(
      routes(await r("riskmodels_portfolio_exposure", { positions: [{ ticker: "tsla", value: -5000 }] })),
    ).toEqual(["POST /portfolio/exposure"]);
    expect(
      routes(
        await r("riskmodels_decompose_selection_vs_drift", { positions: [{ ticker: "MSFT", weight: 0.1 }] }),
      ),
    ).toEqual(["POST /cohorts/pnl-decomposition"]);
    expect(routes(await r("riskmodels_get_my_positions", {}))).toEqual(["GET portal:/api/positions"]);
  });

  it("rejects shares outside the return-attribution view", async () => {
    const h = handlers.get("riskmodels_get_portfolio_risk_snapshot")!;
    expect((await h({ positions: [{ ticker: "AAPL", shares: 10 }] })).isError).toBe(true);
  });

  it("cross-section tools", async () => {
    expect(routes(await r("riskmodels_get_rankings", { ticker: "nvda", metric: "er_l3" }))).toEqual([
      "GET /rankings/NVDA",
    ]);
    expect(
      routes(await r("riskmodels_screen_rankings", { metric: "er_l3", cohort: "universe", window: "21d" })),
    ).toEqual(["POST /rankings/screen"]);
    expect(routes(await r("riskmodels_get_cohorts", {}))).toEqual(["GET /cohorts"]);
    expect(routes(await r("riskmodels_get_cohorts", { series: true }))).toEqual(["GET /cohorts/series"]);
    expect(routes(await r("riskmodels_get_peers", { ticker: "nvda", limit: 5 }))).toEqual(["GET /peers"]);
  });

  it("search dispatches by type", async () => {
    const stock = await r("riskmodels_search", { q: "nvidia" });
    expect(routes(stock)).toEqual(["GET /tickers"]);
    expect(stock[0]!.query).toEqual({ search: "nvidia" });
    expect(routes(await r("riskmodels_search", { type: "etf", q: "SMH" }))).toEqual(["GET /data/etf/search"]);
    expect(routes(await r("riskmodels_search", { type: "fund", q: "contrafund" }))).toEqual(["GET /funds/search"]);
    expect(routes(await r("riskmodels_search", { type: "filer", q: "berkshire" }))).toEqual([
      "GET /13f/filers/search",
    ]);
    expect((await handlers.get("riskmodels_search")!({ type: "filer" })).isError).toBe(true);
  });

  it("entity tools add the holdings route only when asked", async () => {
    expect(routes(await r("riskmodels_get_filer", { bw_filer_id: "BW-FILER-CIK0001067983" }))).toEqual([
      "GET /13f/filers/BW-FILER-CIK0001067983/snapshot",
    ]);
    const filer = await r("riskmodels_get_filer", { bw_filer_id: "BW-FILER-CIK0001067983", holdings_top: 10 });
    expect(routes(filer)).toEqual([
      "GET /13f/filers/BW-FILER-CIK0001067983/snapshot",
      "GET /13f/filers/BW-FILER-CIK0001067983/holdings",
    ]);
    expect(filer[1]!.query).toEqual({ top: "10" });

    expect(routes(await r("riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457" }))).toEqual([
      "GET /funds/snapshot/BW-FUND-S000019457",
    ]);
    const fund = await r("riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457", holdings_limit: 50 });
    expect(routes(fund)).toEqual(["GET /funds/snapshot/BW-FUND-S000019457", "GET /funds/BW-FUND-S000019457/holdings"]);
    expect(fund[1]!.query).toEqual({ limit: "50" });

    expect(
      routes(
        await r("riskmodels_get_fund", {
          bw_fund_id: "BW-FUND-S000019457",
          include: ["hedge", "nav_history", "portfolio_history", "metrics"],
        }),
      ),
    ).toEqual([
      "GET /funds/snapshot/BW-FUND-S000019457",
      "GET /funds/BW-FUND-S000019457/hedge",
      "GET /funds/BW-FUND-S000019457/nav",
      "GET /funds/BW-FUND-S000019457/portfolio",
      "GET /funds/BW-FUND-S000019457",
    ]);
    expect(
      routes(
        await r("riskmodels_get_filer", {
          bw_filer_id: "BW-FILER-CIK0001067983",
          include: ["holdings", "concentration", "portfolio_history", "metrics"],
        }),
      ),
    ).toEqual([
      "GET /13f/filers/BW-FILER-CIK0001067983/snapshot",
      "GET /13f/filers/BW-FILER-CIK0001067983/holdings",
      "GET /13f/filers/BW-FILER-CIK0001067983/concentration",
      "GET /13f/filers/BW-FILER-CIK0001067983/portfolio",
      "GET /13f/filers/BW-FILER-CIK0001067983",
    ]);

    expect(routes(await r("riskmodels_get_etf", { ticker: "smh" }))).toEqual(["GET /data/etf/SMH"]);
    expect(routes(await r("riskmodels_get_etf", { ticker: "smh", holdings_top: 5 }))).toEqual([
      "GET /data/etf/SMH",
      "GET /data/etf/SMH/holdings",
    ]);

    expect(
      routes(await r("riskmodels_get_benchmark_fit", { subject: "BW-FUND-S000019457", benchmark: "ff_own" })),
    ).toEqual(["GET /data/benchmark-fit"]);
  });

  it("factor returns dispatch by kind", async () => {
    expect(routes(await r("riskmodels_get_factor_returns", { kind: "macro", factors: "oil" }))).toEqual([
      "GET /macro-factors",
    ]);
    expect(routes(await r("riskmodels_get_factor_returns", { kind: "sector_etf", sleeve: "sector" }))).toEqual([
      "GET /etf/factor-returns",
    ]);
  });

  it("a failed include is reported in errors without failing the call", async () => {
    const h = harness(["/funds/BW-FUND-X/nav"]);
    const result = await h.handlers.get("riskmodels_get_fund")!({
      bw_fund_id: "BW-FUND-X",
      include: ["hedge", "nav_history"],
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]!.text!);
    expect(payload.snapshot).toBeDefined();
    expect(payload.hedge).toBeDefined();
    expect(payload.nav_history).toBeUndefined();
    expect(payload.errors.nav_history).toContain("500");
  });

  it("every shared tool was routed above", () => {
    expect([...exercised].sort()).toEqual(NPM_TOOLS);
  });
});
