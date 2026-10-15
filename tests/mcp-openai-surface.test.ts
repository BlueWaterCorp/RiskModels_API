import { describe, expect, it } from "vitest";

import { createMcpServer, stripPriceSentence } from "@/lib/mcp/server";
import {
  FIRST_LIVE_PROMPT_MCP,
  MCP_SERVER_INSTRUCTIONS,
  OPENAI_MCP_SERVER_INSTRUCTIONS,
} from "@/lib/mcp/activation";
import { RISKMODELS_TOOL_NAMES, registerRiskModelsPrompts } from "@/lib/mcp/tools/riskmodels-tools";

/**
 * OpenAI surface (`/api/mcp/openai`). Since tool set 2.0 it serves exactly
 * what `/api/mcp/sse` serves: same tools, titles, descriptions, schemas,
 * server instructions and prompts. The exact tool list is pinned in
 * mcp-tool-surfaces.test.ts.
 */

type Registered = {
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: { shape?: Record<string, unknown> };
};

function server(surface: "default" | "openai") {
  return createMcpServer({ apiKey: "rm_agent_live_test", surface }) as unknown as {
    _registeredTools: Record<string, Registered>;
    _registeredPrompts: Record<string, unknown>;
    server: { _instructions?: string };
  };
}

const TOOL_REF = /\b(?:riskmodels_[a-z_]+|get_(?:l3_decomposition|metrics|portfolio_risk_snapshot|fundamentals)|post_snapshot)\b/g;

describe("MCP OpenAI surface", () => {
  const openai = server("openai");
  const sse = server("default");

  it("registers the same tools as /api/mcp/sse, with identical metadata except the per-call price sentence", () => {
    expect(Object.keys(openai._registeredTools).sort()).toEqual(Object.keys(sse._registeredTools).sort());
    for (const [name, t] of Object.entries(openai._registeredTools)) {
      const d = sse._registeredTools[name]!;
      expect(t.title, name).toBe(d.title);
      // OpenAI surface: same text minus the trailing per-call price sentence.
      expect(t.description, name).toBe(stripPriceSentence(d.description ?? ""));
      expect(t.annotations, name).toEqual(d.annotations);
      expect(Object.keys(t.inputSchema?.shape ?? {}), name).toEqual(Object.keys(d.inputSchema?.shape ?? {}));
    }
  });

  it("registers the same prompts and instructions", () => {
    expect(Object.keys(openai._registeredPrompts)).toEqual(Object.keys(sse._registeredPrompts));
    expect(openai.server._instructions).toBe(OPENAI_MCP_SERVER_INSTRUCTIONS);
    expect(sse.server._instructions).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("server instructions and every prompt name only tools that exist on all surfaces", async () => {
    const texts: string[] = [MCP_SERVER_INSTRUCTIONS, FIRST_LIVE_PROMPT_MCP];
    const handlers: Array<(a: Record<string, string>) => { messages: Array<{ content: { text: string } }> }> = [];
    registerRiskModelsPrompts(
      {
        registerTool: () => undefined,
        registerResource: () => undefined,
        registerPrompt: (_n: string, _c: unknown, h: any) => handlers.push(h),
      } as never,
      FIRST_LIVE_PROMPT_MCP,
    );
    expect(handlers.length).toBe(5);
    for (const h of handlers) texts.push(...(await h({})).messages.map((m) => m.content.text));
    const names = new Set<string>(RISKMODELS_TOOL_NAMES);
    for (const text of texts) {
      for (const ref of text.match(TOOL_REF) ?? []) expect(names.has(ref), ref).toBe(true);
    }
  });
});
