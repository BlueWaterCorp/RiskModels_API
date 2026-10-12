import { describe, expect, it } from "vitest";

import { createMcpServer } from "@/lib/mcp/server";
import {
  OPENAI_FIRST_LIVE_PROMPT,
  OPENAI_MCP_SERVER_INSTRUCTIONS,
  OPENAI_TOOL_OVERRIDES,
  registerOpenAiOnlyTools,
} from "@/lib/mcp/openai-surface";

/**
 * OpenAI tool surface (`/api/mcp/openai`). The default surface is covered by
 * mcp-directory-compliance.test.ts and must not change; this file pins the
 * OpenAI-specific list.
 */

type Registered = {
  title?: string;
  description?: string;
  annotations?: { title?: string; readOnlyHint?: unknown; destructiveHint?: unknown; openWorldHint?: unknown };
  inputSchema?: { shape?: Record<string, unknown> };
};

function tools(surface: "default" | "openai"): Record<string, Registered> {
  const server = createMcpServer({ apiKey: "rm_agent_live_test", surface });
  return (server as unknown as { _registeredTools: Record<string, Registered> })._registeredTools;
}

const EXPECTED_OPENAI_TOOLS = [
  "get_l3_decomposition",
  "get_metrics",
  "get_portfolio_risk_snapshot",
  "riskmodels_analyze_portfolio",
  "riskmodels_compare",
  "riskmodels_decompose",
  "riskmodels_decompose_selection_vs_drift",
  "riskmodels_get_benchmark_fit",
  "riskmodels_get_cohorts",
  "riskmodels_get_etf",
  "riskmodels_get_etf_holdings",
  "riskmodels_get_filer_holdings",
  "riskmodels_get_filer_snapshot",
  "riskmodels_get_fund_holdings",
  "riskmodels_get_fund_snapshot",
  "riskmodels_get_fundamentals",
  "riskmodels_get_hedge_levels",
  "riskmodels_get_macro_correlation",
  "riskmodels_get_macro_factor_returns",
  "riskmodels_get_my_positions",
  "riskmodels_get_peers",
  "riskmodels_get_rankings",
  "riskmodels_get_residual_returns",
  "riskmodels_get_residual_returns_batch",
  "riskmodels_get_residual_signal",
  "riskmodels_get_return_attribution",
  "riskmodels_get_returns",
  "riskmodels_get_sector_etf_returns",
  "riskmodels_hedge_portfolio",
  "riskmodels_hedge_position",
  "riskmodels_portfolio_decompose",
  "riskmodels_portfolio_exposure",
  "riskmodels_render_artifact",
  "riskmodels_screen_rankings",
  "riskmodels_search_etfs",
  "riskmodels_search_filers",
  "riskmodels_search_funds",
  "riskmodels_search_tickers",
  "riskmodels_whitepaper_example",
];

describe("MCP OpenAI surface", () => {
  const openai = tools("openai");
  const names = Object.keys(openai);

  it("registers exactly the expected tools", () => {
    expect([...names].sort()).toEqual([...EXPECTED_OPENAI_TOOLS].sort());
  });

  it("leaves out the generic REST reader, the catalog tools and the Lstar names", () => {
    for (const gone of [
      "riskmodels_call_endpoint",
      "riskmodels_get_lstar",
      "riskmodels_batch_lstar",
      "riskmodels_list_endpoints",
      "riskmodels_get_capability",
      "riskmodels_get_schema",
    ]) {
      expect(names, gone).not.toContain(gone);
    }
  });

  it("every tool has a title and explicit boolean readOnly/destructive/openWorld hints", () => {
    for (const [name, t] of Object.entries(openai)) {
      expect(t.title, name).toBeTruthy();
      expect(t.annotations?.title, name).toBe(t.title);
      expect(t.annotations?.readOnlyHint, name).toBe(true);
      expect(t.annotations?.destructiveHint, name).toBe(false);
      expect(t.annotations?.openWorldHint, name).toBe(true);
    }
  });

  it("descriptions carry no presentation commands or tool-invocation instructions", () => {
    const steering =
      /\briskmodels_[a-z_]+\b|\bget_(l3_decomposition|metrics|portfolio_risk_snapshot)\b|render the|prefer\b|\balways\b|\bnever\b|tell the user|use this|\bcall (riskmodels|this)|\bskip this\b|first\b.*\bbefore\b/i;
    for (const [name, t] of Object.entries(openai)) {
      expect(t.description, name).toBeTruthy();
      expect(t.description!, name).not.toMatch(steering);
    }
  });

  it("residual-returns tools describe residual returns and hedge depth, not Lstar", () => {
    for (const name of ["riskmodels_get_residual_returns", "riskmodels_get_residual_returns_batch"]) {
      const t = openai[name]!;
      expect(t.title, name).toMatch(/Residual Returns and Recommended Hedge Depth/);
      expect(t.title, name).not.toMatch(/lstar/i);
      expect(t.description, name).toMatch(/residual/i);
      expect(t.description, name).toMatch(/recommended hedge depth/i);
      expect(t.description!.split(/GET \/lstar|POST \/batch\/lstar/).join(""), name).not.toMatch(/lstar/i);
    }
  });

  it("renamed tools keep the shared input schema", () => {
    const def = tools("default");
    for (const [from, o] of Object.entries(OPENAI_TOOL_OVERRIDES)) {
      expect(Object.keys(openai[o.name]!.inputSchema?.shape ?? {}), from).toEqual(
        Object.keys(def[from]!.inputSchema?.shape ?? {}),
      );
    }
  });

  it("server instructions and first prompt name only tools on this surface", () => {
    for (const text of [OPENAI_MCP_SERVER_INSTRUCTIONS, OPENAI_FIRST_LIVE_PROMPT]) {
      const refs = text.match(/\b(?:riskmodels_[a-z_]+|get_(?:l3_decomposition|metrics|portfolio_risk_snapshot))\b/g) ?? [];
      for (const ref of refs) expect(names, ref).toContain(ref);
    }
  });

  it("explicit tools call one fixed GET route each", async () => {
    const handlers = new Map<string, (a: any) => Promise<unknown>>();
    const calls: string[] = [];
    const sdk = {
      call: async (m: string, p: string, o?: { query?: Record<string, unknown> }) => {
        calls.push(`${m} ${p} ${JSON.stringify(o?.query ?? {})}`);
        return { ok: true };
      },
    };
    registerOpenAiOnlyTools(sdk as never, {
      registerTool: (n: string, _c: unknown, h: any) => handlers.set(n, h),
      registerResource: () => undefined,
    } as never);
    await handlers.get("riskmodels_get_peers")!({ ticker: "nvda", limit: 5 });
    await handlers.get("riskmodels_search_funds")!({ q: "contrafund" });
    await handlers.get("riskmodels_get_fund_snapshot")!({ bw_fund_id: "BW-FUND-S000019457" });
    await handlers.get("riskmodels_get_fund_holdings")!({ bw_fund_id: "BW-FUND-S000019457", limit: 10 });
    await handlers.get("riskmodels_get_macro_factor_returns")!({ factors: "oil" });
    await handlers.get("riskmodels_get_sector_etf_returns")!({ sleeve: "sector" });
    expect(calls).toEqual([
      'GET /peers {"ticker":"NVDA","limit":5}',
      'GET /funds/search {"q":"contrafund"}',
      "GET /funds/snapshot/BW-FUND-S000019457 {}",
      'GET /funds/BW-FUND-S000019457/holdings {"limit":10}',
      'GET /macro-factors {"factors":"oil"}',
      'GET /etf/factor-returns {"sleeve":"sector"}',
    ]);
  });

  it("the default surface is unchanged", () => {
    const def = Object.keys(tools("default"));
    expect(def).toHaveLength(37);
    expect(def).toContain("riskmodels_call_endpoint");
    expect(def).toContain("riskmodels_get_lstar");
    expect(def).toContain("riskmodels_batch_lstar");
    expect(def).not.toContain("riskmodels_get_residual_returns");
    expect(def).not.toContain("riskmodels_get_peers");
    for (const n of ["riskmodels_list_endpoints", "riskmodels_get_capability", "riskmodels_get_schema"]) {
      expect(def).toContain(n);
    }
  });
});
