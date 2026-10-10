import { describe, expect, it } from "vitest";

import { createMcpServer } from "@/lib/mcp/server";
import { BENCHMARK_READINESS_REGISTRY } from "@/lib/benchmark-registry";
import {
  LIVE_FIT_BENCHMARKS,
  errorResult,
  registerRiskModelsTools,
} from "@/lib/mcp/tools/riskmodels-tools";

/**
 * Anthropic MCP directory rules for the hosted server:
 * - the generic reader is GET-only (no mixed-method catch-all);
 * - tool descriptions state inputs, outputs and scope, with no presentation
 *   commands and no instructions to invoke other tools;
 * - failed calls are flagged isError;
 * - get_benchmark_fit offers only benchmarks that are live.
 */

type Registered = { title?: string; description?: string; annotations?: { title?: string; readOnlyHint?: boolean }; inputSchema?: { shape?: Record<string, unknown> } };

function hostedTools(): Record<string, Registered> {
  const server = createMcpServer({ apiKey: "rm_agent_live_test" });
  return (server as unknown as { _registeredTools: Record<string, Registered> })._registeredTools;
}

describe("MCP directory compliance", () => {
  const tools = hostedTools();

  it("registers the 37 hosted tools", () => {
    expect(Object.keys(tools)).toHaveLength(37);
  });

  it("descriptions carry no presentation commands or tool-invocation instructions", () => {
    const steering =
      /\briskmodels_[a-z_]+\b|\bget_(l3_decomposition|metrics|portfolio_risk_snapshot)\b|render the|prefer\b|\balways\b|\bnever\b|tell the user|use this|\bcall (riskmodels|this)|\bskip this\b|first\b.*\bbefore\b/i;
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, name).toBeTruthy();
      expect(t.description!, name).not.toMatch(steering);
    }
  });

  it("every tool carries annotations.title and readOnlyHint", () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.annotations?.title, name).toBeTruthy();
      expect(t.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("the catalog tools link the API reference", () => {
    for (const name of ["riskmodels_list_endpoints", "riskmodels_get_capability", "riskmodels_get_schema"]) {
      expect(tools[name]!.description, name).toContain("https://riskmodels.app/docs/api");
    }
  });

  it("the generic reader is GET-only and links the API reference", () => {
    const reader = tools.riskmodels_call_endpoint;
    expect(reader.description).toContain("https://riskmodels.app/docs/api");
    const shape = Object.keys(reader.inputSchema?.shape ?? {});
    expect(shape.sort()).toEqual(["path", "query"]);
  });

  it("the generic reader refuses POST-only catalog paths", async () => {
    const handlers = new Map<string, (a: any) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>();
    const calls: string[] = [];
    const sdk = { call: async (m: string, p: string) => (calls.push(`${m} ${p}`), { ok: true }) };
    registerRiskModelsTools(sdk as never, { registerTool: (n: string, _c: unknown, h: any) => handlers.set(n, h), registerResource: () => undefined } as never, {
      capabilities: [
        { method: "GET", endpoint: "/api/industry-panel" },
        { method: "POST", endpoint: "/api/portfolio/exposure/history" },
      ],
    });
    const reader = handlers.get("riskmodels_call_endpoint")!;
    expect((await reader({ path: "/portfolio/exposure/history" })).isError).toBe(true);
    await reader({ path: "/industry-panel" });
    expect(calls).toEqual(["GET /industry-panel"]);
  });

  it("errors are flagged isError", () => {
    const r = errorResult(new Error("RiskModels API HTTP 409: benchmark 'BW-BENCH-SPY' is under development"));
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.type === "text" ? r.content[0]!.text : "{}").error).toContain("409");
  });

  it("get_benchmark_fit offers exactly the live benchmarks plus all", () => {
    const live = BENCHMARK_READINESS_REGISTRY.filter((e) => e.status === "live" && !e.id.startsWith("BW-BENCH-")).map((e) => e.id);
    expect([...LIVE_FIT_BENCHMARKS].sort()).toEqual([...live, "all"].sort());
  });
});
