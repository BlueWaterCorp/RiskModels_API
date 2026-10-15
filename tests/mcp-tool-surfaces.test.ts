import { describe, expect, it } from "vitest";

import { createMcpServer as createHostedServer } from "@/lib/mcp/server";
import { createMcpServer as createNpmServer } from "../mcp/src/server";
import {
  HOSTED_ONLY_TOOL_NAMES,
  INCLUDE_HISTORY_MONTHS,
  RISKMODELS_TOOL_NAMES,
  historyStartDate,
  includeFailure,
  registerRiskModelsTools,
} from "@/lib/mcp/tools/riskmodels-tools";
import { RiskModelsClient } from "../packages/riskmodels-sdk/src/client";

/**
 * MCP tool set 2.0: one registry for all three surfaces.
 * - npm stdio (`mcp/src/server.ts`): the 24 shared tools;
 * - hosted `/api/mcp/sse` and `/api/mcp/openai` (`lib/mcp/server.ts`): the
 *   same 24 plus riskmodels_render_artifact.
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
  // One table: each surface's exact sorted tool list. The npm row loads the
  // stdio factory from mcp/src/server.ts, so CI covers the published package.
  it.each([
    ["npm stdio (mcp/src/server.ts)", () => createNpmServer({ apiKey: "rm_agent_live_test", apiBase: "https://riskmodels.test" }), NPM_TOOLS],
    ["hosted /api/mcp/sse", () => createHostedServer({ apiKey: "rm_agent_live_test", surface: "default" }), HOSTED_TOOLS],
    ["hosted /api/mcp/openai", () => createHostedServer({ apiKey: "rm_agent_live_test", surface: "openai" }), HOSTED_TOOLS],
  ] as const)("%s registers exactly its pinned tool list", (_surface, make, expected) => {
    expect(toolNames(make())).toEqual([...expected]);
  });

  it("pinned counts: 24 npm, 25 hosted", () => {
    expect(NPM_TOOLS).toHaveLength(24);
    expect(HOSTED_TOOLS).toHaveLength(25);
  });

  it("the exported name lists match the registrations", () => {
    expect([...RISKMODELS_TOOL_NAMES].sort()).toEqual(NPM_TOOLS);
    expect([...HOSTED_ONLY_TOOL_NAMES]).toEqual(["riskmodels_render_artifact"]);
  });

  it("the OpenAI surface states prices in its instructions, not in tool descriptions", () => {
    type T = { description?: string; annotations?: unknown; inputSchema?: { shape?: Record<string, unknown> } };
    const tools = (s: unknown) => (s as { _registeredTools: Record<string, T> })._registeredTools;
    const openai = tools(createHostedServer({ apiKey: "k", surface: "openai" }));
    const sse = tools(createHostedServer({ apiKey: "k", surface: "default" }));
    let priced = 0;
    for (const name of HOSTED_TOOLS) {
      expect(openai[name]!.description, name).not.toMatch(/Price:/);
      if (/Price:/.test(sse[name]!.description ?? "")) priced++;
      expect(sse[name]!.description!.startsWith(openai[name]!.description!), name).toBe(true);
      expect(openai[name]!.annotations, name).toEqual(sse[name]!.annotations);
      expect(Object.keys(openai[name]!.inputSchema?.shape ?? {}), name).toEqual(Object.keys(sse[name]!.inputSchema?.shape ?? {}));
    }
    expect(priced).toBeGreaterThan(20);
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

/** `fail` maps a REST path to the HTTP status and error body that path answers with. */
function harness(fail: Record<string, [number, string]> = {}) {
  const calls: Call[] = [];
  const stubFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.origin === "https://portal.test" ? `portal:${url.pathname}` : url.pathname.replace(/^\/api/, "");
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const failure = fail[path];
    if (failure) {
      return new Response(JSON.stringify({ error: failure[1] }), {
        status: failure[0],
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ticker: "NVDA", results: {}, positions: [], end_teo: "2026-09-30" }), {
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
  return { run, handlers, calls };
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

  it("residual returns: one ticker uses GET /lstar, 2-100 use POST /batch/lstar", async () => {
    const one = await r("riskmodels_get_residual_returns", { tickers: ["nvda"], years: 2 });
    expect(routes(one)).toEqual(["GET /lstar"]);
    expect(one[0]!.query).toEqual({ ticker: "NVDA", years: "2" });

    const many = await r("riskmodels_get_residual_returns", { tickers: ["aapl", "msft"], years: 3 });
    expect(routes(many)).toEqual(["POST /batch/lstar"]);
    expect(many[0]!.body).toEqual({ tickers: ["AAPL", "MSFT"], years: 3 });
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

    const snap = await r("riskmodels_get_portfolio_risk_snapshot", {
      positions: [
        { ticker: "aapl", weight: 0.4 },
        { ticker: "NVDA", dollars: 35 },
      ],
    });
    expect(routes(snap)).toEqual(["POST /snapshot"]);
    expect(snap[0]!.body).toEqual({
      type: "portfolio",
      portfolio: [
        { ticker: "AAPL", weight: 0.4 },
        { ticker: "NVDA", weight: 35 },
      ],
      lookback_days: 252,
    });
    const shares = await r("riskmodels_get_portfolio_risk_snapshot", {
      positions: [{ ticker: "AAPL", shares: 10 }],
      lookback_days: 504,
      benchmark: "SPY",
    });
    expect(routes(shares)).toEqual(["POST /snapshot"]);
    expect(shares[0]!.body).toEqual({
      type: "portfolio",
      portfolio: [{ ticker: "AAPL", shares: 10 }],
      lookback_days: 504,
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

  it("rejects a position with both a weight and shares", async () => {
    const h = handlers.get("riskmodels_get_portfolio_risk_snapshot")!;
    expect((await h({ positions: [{ ticker: "AAPL", weight: 1, shares: 10 }] })).isError).toBe(true);
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
    // The holdings route reads `limit`; holdings_top maps onto it.
    expect(filer[1]!.query).toEqual({ limit: "10" });

    expect(routes(await r("riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457" }))).toEqual([
      "GET /funds/snapshot/BW-FUND-S000019457",
    ]);
    const fund = await r("riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457", holdings_limit: 50 });
    expect(routes(fund)).toEqual(["GET /funds/snapshot/BW-FUND-S000019457", "GET /funds/BW-FUND-S000019457/holdings"]);
    expect(fund[1]!.query).toEqual({ limit: "50" });

    expect(routes(await r("riskmodels_get_etf", { ticker: "smh" }))).toEqual(["GET /data/etf/SMH"]);
    expect(routes(await r("riskmodels_get_etf", { ticker: "smh", holdings_top: 5 }))).toEqual([
      "GET /data/etf/SMH",
      "GET /data/etf/SMH/holdings",
    ]);

    expect(
      routes(await r("riskmodels_get_benchmark_fit", { subject: "BW-FUND-S000019457", benchmark: "ff_own" })),
    ).toEqual(["GET /data/benchmark-fit"]);
  });

  it("each fund include value adds one GET after the snapshot", async () => {
    const id = "BW-FUND-S000019457";
    const cases: Array<[string, string, boolean]> = [
      ["hedge", `GET /funds/${id}/hedge`, false],
      ["nav_history", `GET /funds/${id}/nav`, true],
      ["portfolio_history", `GET /funds/${id}/portfolio`, true],
      ["metrics", `GET /funds/${id}`, false],
    ];
    for (const [value, route, windowed] of cases) {
      const calls = await r("riskmodels_get_fund", { bw_fund_id: id, include: [value] });
      expect(routes(calls), value).toEqual([`GET /funds/snapshot/${id}`, route]);
      if (windowed) {
        expect(Object.keys(calls[1]!.query), value).toEqual(["start_date"]);
        expect(calls[1]!.query.start_date, value).toBe(historyStartDate(INCLUDE_HISTORY_MONTHS));
      } else {
        expect(calls[1]!.query, value).toEqual({});
      }
    }
    const months = await r("riskmodels_get_fund", { bw_fund_id: id, include: ["nav_history"], history_months: 6 });
    expect(months[1]!.query).toEqual({ start_date: historyStartDate(6) });
  });

  it("each filer include value adds one GET after the snapshot", async () => {
    const id = "BW-FILER-CIK0001067983";
    const cases: Array<[string, string, boolean]> = [
      ["concentration", `GET /13f/filers/${id}/concentration`, true],
      ["portfolio_history", `GET /13f/filers/${id}/portfolio`, true],
      ["metrics", `GET /13f/filers/${id}`, false],
    ];
    for (const [value, route, windowed] of cases) {
      const calls = await r("riskmodels_get_filer", { bw_filer_id: id, include: [value] });
      expect(routes(calls), value).toEqual([`GET /13f/filers/${id}/snapshot`, route]);
      expect(calls[1]!.query, value).toEqual(windowed ? { start_date: historyStartDate(INCLUDE_HISTORY_MONTHS) } : {});
    }
  });

  it("snapshot=false fetches only holdings and include values", async () => {
    const fund = await r("riskmodels_get_fund", {
      bw_fund_id: "BW-FUND-S000019457",
      snapshot: false,
      holdings_limit: 5000,
    });
    expect(routes(fund)).toEqual(["GET /funds/BW-FUND-S000019457/holdings"]);
    expect(
      routes(await r("riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457", snapshot: false, include: ["hedge"] })),
    ).toEqual(["GET /funds/BW-FUND-S000019457/hedge"]);
    expect(
      routes(
        await r("riskmodels_get_filer", { bw_filer_id: "BW-FILER-CIK0001067983", snapshot: false, holdings_top: 20 }),
      ),
    ).toEqual(["GET /13f/filers/BW-FILER-CIK0001067983/holdings"]);
    expect(routes(await r("riskmodels_get_etf", { ticker: "smh", snapshot: false, holdings_top: 5 }))).toEqual([
      "GET /data/etf/SMH/holdings",
    ]);

    for (const [tool, args] of [
      ["riskmodels_get_fund", { bw_fund_id: "BW-FUND-S000019457", snapshot: false }],
      ["riskmodels_get_filer", { bw_filer_id: "BW-FILER-CIK0001067983", snapshot: false }],
      ["riskmodels_get_etf", { ticker: "smh", snapshot: false }],
    ] as const) {
      const res = await handlers.get(tool)!(args);
      expect(res.isError, tool).toBe(true);
      expect(JSON.parse(res.content[0]!.text!).error, tool).toMatch(/snapshot=false needs/);
    }
  });

  it("factor returns dispatch by kind", async () => {
    expect(routes(await r("riskmodels_get_factor_returns", { kind: "macro", factors: "oil" }))).toEqual([
      "GET /macro-factors",
    ]);
    expect(routes(await r("riskmodels_get_factor_returns", { kind: "sector_etf", sleeve: "sector" }))).toEqual([
      "GET /etf/factor-returns",
    ]);
  });

  it("every shared tool was routed above", () => {
    expect([...exercised].sort()).toEqual(NPM_TOOLS);
  });
});

describe("entity include values: response shape and billing", () => {
  const parse = (res: { content: Array<{ text?: string }> }) => JSON.parse(res.content[0]!.text!);
  const FUND = "BW-FUND-S000019457";

  it("a failed include is reported in its block; the result stays a success and bills only what succeeded", async () => {
    const { handlers } = harness({ [`/funds/${FUND}/nav`]: [404, "No NAV history for fund"] });
    const res = await handlers.get("riskmodels_get_fund")!({
      bw_fund_id: FUND,
      holdings_limit: 25,
      include: ["hedge", "nav_history", "hedge"],
    });
    expect(res.isError).toBeFalsy();
    const body = parse(res);
    expect(Object.keys(body)).toEqual(["snapshot", "holdings", "includes", "billing"]);
    expect(Object.keys(body.includes)).toEqual(["hedge", "nav_history"]);
    expect(body.includes.hedge.end_teo).toBe("2026-09-30");
    expect(body.includes.nav_history).toEqual({ ok: false, status: 404, error: "No NAV history for fund" });
    expect(body.billing).toEqual({ base_usd: 0.07, includes_usd: { hedge: 0.02, nav_history: 0 }, total_usd: 0.09 });
  });

  it("every include ok: billing totals the snapshot plus each include", async () => {
    const { handlers } = harness();
    const body = parse(
      await handlers.get("riskmodels_get_filer")!({
        bw_filer_id: "BW-FILER-CIK0001067983",
        include: ["concentration", "portfolio_history", "metrics"],
      }),
    );
    expect(body.holdings).toBeUndefined();
    expect(body.billing).toEqual({
      base_usd: 0.05,
      includes_usd: { concentration: 0.02, portfolio_history: 0.02, metrics: 0.02 },
      total_usd: 0.11,
    });
    const bare = parse(await handlers.get("riskmodels_get_fund")!({ bw_fund_id: FUND }));
    expect(bare.includes).toEqual({});
    expect(bare.billing).toEqual({ base_usd: 0.05, includes_usd: {}, total_usd: 0.05 });
  });

  it("a failed snapshot is a tool error and fires no include", async () => {
    const { handlers, calls } = harness({ [`/funds/snapshot/${FUND}`]: [404, "Fund not found"] });
    const res = await handlers.get("riskmodels_get_fund")!({ bw_fund_id: FUND, include: ["hedge", "metrics"] });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toContain("HTTP 404");
    expect(routes(calls)).toEqual([`GET /funds/snapshot/${FUND}`]);
  });

  it("includeFailure parses the SDK error; historyStartDate counts back whole months", () => {
    expect(includeFailure(new Error("RiskModels API HTTP 503: upstream timeout"))).toEqual({
      ok: false,
      status: 503,
      error: "upstream timeout",
    });
    expect(includeFailure(new Error("RiskModels API request failed with HTTP 500"))).toEqual({
      ok: false,
      status: 500,
      error: "RiskModels API request failed with HTTP 500",
    });
    expect(includeFailure(new Error("fetch failed"))).toEqual({ ok: false, status: null, error: "fetch failed" });
    expect(historyStartDate(24, new Date("2026-10-15T12:00:00Z"))).toBe("2024-10-15");
  });
});
