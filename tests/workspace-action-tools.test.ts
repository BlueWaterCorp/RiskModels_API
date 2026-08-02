/**
 * Workspace command-bus producer tools (G.36) — schema generation.
 *
 * The tool manifest must be a projection of the Risk_Models mirror
 * (`workspace-action-contract.mirror.json`), never hand-written: offering an
 * action the bus refuses recreates the "analyst describes actions it cannot
 * take" hole from the producer side. These tests pin the projection; the CI
 * workflow `workspace-action-contract-drift.yml` pins the mirror itself to
 * Risk_Models's canonical file.
 */

import { describe, expect, it } from "vitest";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import mirror from "@/lib/chat/workspace-action-contract.mirror.json";
import {
  collectWorkspaceActions,
  WORKSPACE_ACTION_TOOLS_REGISTRY,
  WORKSPACE_CHAT_TOOLS,
  WORKSPACE_TOOL_MAP,
} from "@/lib/chat/workspace-action-tools";
import { encodeSseEvent } from "@/lib/chat/stream-events";
import type { ToolCallResult } from "@/lib/chat/tool-executor";

type FnTool = Extract<ChatCompletionTool, { type: "function" }>;

function schemaOf(name: string): Record<string, unknown> {
  const tool = WORKSPACE_TOOL_MAP[name].openaiTool as FnTool;
  return tool.function.parameters as Record<string, unknown>;
}

describe("workspace action tool manifest (generated from the mirror)", () => {
  it("offers exactly the two dispatched actions, both free of billing", () => {
    expect(WORKSPACE_ACTION_TOOLS_REGISTRY.map((t) => t.name).sort()).toEqual([
      "set_subject",
      "set_window",
    ]);
    for (const t of WORKSPACE_ACTION_TOOLS_REGISTRY) {
      expect(t.capabilityId).toBeNull();
    }
  });

  it("offers nothing the bus does not support", () => {
    const supported = new Set(mirror.supported_actions);
    const unsupported = new Set(mirror.unsupported_actions);
    for (const t of WORKSPACE_ACTION_TOOLS_REGISTRY) {
      expect(supported.has(t.name)).toBe(true);
      expect(unsupported.has(t.name)).toBe(false);
    }
  });

  it("set_window's preset enum is exactly the mirror's preset table", () => {
    const params = schemaOf("set_window");
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.preset.enum).toEqual(Object.keys(mirror.window_presets));
    expect(params.required).toEqual(["preset"]);
    expect(params.additionalProperties).toBe(false);
  });

  it("set_subject's kind enum is exactly the mirror's subject kinds", () => {
    const params = schemaOf("set_subject");
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.subject_kind.enum).toEqual(mirror.subject_kinds);
    expect(params.required).toEqual(["subject_id", "subject_kind"]);
  });

  it("every preset in the manifest maps to an offered lookback (no un-performable windows)", () => {
    for (const days of Object.values(mirror.window_presets)) {
      expect(mirror.offered_lookback_days).toContain(days);
    }
  });

  it("WORKSPACE_CHAT_TOOLS mirrors the registry 1:1", () => {
    expect(WORKSPACE_CHAT_TOOLS).toHaveLength(WORKSPACE_ACTION_TOOLS_REGISTRY.length);
  });
});

describe("workspace action executors", () => {
  it("set_window shapes a WorkspaceAction the bus understands, and confirms nothing", async () => {
    const out = (await WORKSPACE_TOOL_MAP.set_window.executor({
      preset: "1y",
    })) as Record<string, unknown>;
    expect(out.action).toEqual({ type: "set_window", window: { preset: "1y" } });
    expect(out.status).toBe("dispatched_to_workspace");
    expect(String(out.note)).toMatch(/may\s+refuse/i);
  });

  it("set_subject shapes a WorkspaceAction with id + kind only (label belongs to the client)", async () => {
    const out = (await WORKSPACE_TOOL_MAP.set_subject.executor({
      subject_id: "BW-FILER-0001067983",
      subject_kind: "filer_13f",
    })) as Record<string, unknown>;
    expect(out.action).toEqual({
      type: "set_subject",
      subject: { id: "BW-FILER-0001067983", kind: "filer_13f" },
    });
  });

  it("rejects a window the bus does not offer (a literal '3y' never leaves this side)", () => {
    expect(WORKSPACE_TOOL_MAP.set_window.argSchema.safeParse({ preset: "3y" }).success).toBe(
      false,
    );
    expect(
      WORKSPACE_TOOL_MAP.set_subject.argSchema.safeParse({
        subject_id: "BW-FILER-1",
        subject_kind: "galaxy",
      }).success,
    ).toBe(false);
  });
});

describe("collectWorkspaceActions", () => {
  const ok = (name: string, action: Record<string, unknown>): ToolCallResult => ({
    tool_call_id: `call_${name}`,
    name,
    result: { status: "dispatched_to_workspace", action, note: "" },
    cost_usd: 0,
    capability_id: null,
    latency_ms: 1,
  });

  it("collects only successful workspace-tool results", () => {
    const windowAction = { type: "set_window", window: { preset: "2y" } };
    const results: ToolCallResult[] = [
      ok("set_window", windowAction),
      // Errored workspace call → no action frame; the model sees the arg error.
      {
        tool_call_id: "call_err",
        name: "set_subject",
        result: { error: "Invalid arguments" },
        cost_usd: 0,
        capability_id: null,
        latency_ms: 1,
        error: "Invalid arguments",
      },
      // Ordinary data tool → never an action.
      {
        tool_call_id: "call_data",
        name: "get_risk_metrics",
        result: { action: { type: "set_window" } }, // adversarial shape — wrong registry
        cost_usd: 0.01,
        capability_id: "metrics-snapshot",
        latency_ms: 5,
      },
    ];
    expect(collectWorkspaceActions(results)).toEqual([
      { tool_call_id: "call_set_window", action: windowAction },
    ]);
  });

  it("serializes as a distinct SSE frame type, leaving existing frames untouched", () => {
    const [emitted] = collectWorkspaceActions([
      ok("set_window", { type: "set_window", window: { preset: "1y" } }),
    ]);
    expect(encodeSseEvent({ type: "action", ...emitted })).toBe(
      'event: action\ndata: {"tool_call_id":"call_set_window","action":{"type":"set_window","window":{"preset":"1y"}}}\n\n',
    );
    // Existing frame shape unchanged (pinning the "existing frames unchanged" constraint).
    expect(encodeSseEvent({ type: "delta", text: "hi" })).toBe(
      'event: delta\ndata: {"text":"hi"}\n\n',
    );
  });
});
