import { describe, expect, it } from "vitest";

import { createMcpServer } from "@/lib/mcp/server";
import { createMcpServer as createNpmServer } from "../mcp/src/server";
import { BENCHMARK_READINESS_REGISTRY } from "@/lib/benchmark-registry";
import { LIVE_FIT_BENCHMARKS, errorResult } from "@/lib/mcp/tools/riskmodels-tools";

/**
 * MCP directory rules for every surface (tool set 2.0):
 * - each description starts "Use when …", says "Not for … (use <tool>)",
 *   and states a price; the only tool names it carries are those
 *   "(use riskmodels_…)" cross-references, and each names a tool that exists
 *   on the same surface;
 * - no presentation commands and no instructions to invoke other tools;
 * - every tool carries annotations.title and explicit read-only hints;
 * - failed calls are flagged isError;
 * - get_benchmark_fit offers only benchmarks that are live.
 */

type Registered = {
  title?: string;
  description?: string;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  inputSchema?: { shape?: Record<string, { description?: string }> };
};

function registered(server: unknown): Record<string, Registered> {
  return (server as { _registeredTools: Record<string, Registered> })._registeredTools;
}

const SURFACES: Array<[string, Record<string, Registered>]> = [
  ["hosted", registered(createMcpServer({ apiKey: "rm_agent_live_test" }))],
  ["npm", registered(createNpmServer({ apiKey: "rm_agent_live_test", apiBase: "https://riskmodels.test" }))],
];

/** "(use riskmodels_a)", "(use riskmodels_a or riskmodels_b)", "(use riskmodels_a, riskmodels_b or riskmodels_c)". */
const CROSS_REF = /\(use (riskmodels_[a-z_]+(?:(?:, | or )riskmodels_[a-z_]+)*)\)/g;

const STEERING =
  /\briskmodels_[a-z_]+\b|\bget_(l3_decomposition|metrics|portfolio_risk_snapshot)\b|render the|prefer\b|\balways\b|\bnever\b|tell the user|use this|\bcall (riskmodels|this)|\bskip this\b|first\b.*\bbefore\b/i;

describe.each(SURFACES)("MCP directory compliance (%s)", (_surface, tools) => {
  it("registers 26 hosted / 25 npm tools", () => {
    expect(Object.keys(tools)).toHaveLength(_surface === "hosted" ? 26 : 25);
  });

  it("descriptions follow Use when / Not for / price", () => {
    for (const [name, t] of Object.entries(tools)) {
      const d = t.description ?? "";
      expect(d, name).toMatch(/^Use when /);
      expect(d, name).toMatch(/ Not for .*\(use riskmodels_/);
      expect(d, name).toMatch(/Price: .*\$\d|\bFree\b/);
    }
  });

  it("cross-references name tools on the same surface", () => {
    for (const [name, t] of Object.entries(tools)) {
      for (const m of (t.description ?? "").matchAll(CROSS_REF)) {
        for (const ref of m[1]!.split(/, | or /)) {
          expect(Object.keys(tools), `${name} -> ${ref}`).toContain(ref);
          expect(ref, name).not.toBe(name);
        }
      }
    }
  });

  it("descriptions carry no presentation commands or tool-invocation instructions", () => {
    for (const [name, t] of Object.entries(tools)) {
      const rest = (t.description ?? "").replace(CROSS_REF, "");
      expect(rest, name).not.toMatch(STEERING);
    }
  });

  it("every parameter has a description with an example", () => {
    for (const [name, t] of Object.entries(tools)) {
      for (const [param, schema] of Object.entries(t.inputSchema?.shape ?? {})) {
        const desc = schema?.description ?? "";
        expect(desc, `${name}.${param}`).toBeTruthy();
        if (name === "riskmodels_render_artifact" && param === "params") continue; // per-slug table
        expect(desc, `${name}.${param}`).toMatch(/e\.g\./);
      }
    }
  });

  it("every tool carries annotations.title and explicit readOnly/destructive/openWorld hints", () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.annotations?.title, name).toBeTruthy();
      expect(t.annotations?.title, name).toBe(t.title);
      expect(t.annotations?.readOnlyHint, name).toBe(true);
      expect(t.annotations?.destructiveHint, name).toBe(false);
      expect(t.annotations?.openWorldHint, name).toBe(true);
    }
  });
});

describe("MCP directory compliance (shared)", () => {
  it("prices follow the capability registry where the old copy drifted", () => {
    const [, tools] = SURFACES[0]!;
    expect(tools.riskmodels_get_benchmark_fit!.description).toContain("$0.02 per call");
    expect(tools.riskmodels_get_benchmark_fit!.description).not.toContain("$0.005");
    expect(tools.riskmodels_get_residual_returns!.description).toContain("$0.01 per year beyond the first");
  });

  it("errors are flagged isError", () => {
    const r = errorResult(new Error("RiskModels API HTTP 409: benchmark 'BW-BENCH-SPY' is under development"));
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.type === "text" ? r.content[0]!.text : "{}").error).toContain("409");
  });

  it("get_benchmark_fit offers exactly the live benchmarks plus all", () => {
    const live = BENCHMARK_READINESS_REGISTRY.filter((e) => e.status === "live" && !e.id.startsWith("BW-BENCH-")).map(
      (e) => e.id,
    );
    expect([...LIVE_FIT_BENCHMARKS].sort()).toEqual([...live, "all"].sort());
  });
});
