/**
 * Agent loop × workspace command bus (G.36) — the producer end to end minus
 * the LLM: a scripted provider round through the REAL tool executor (workspace
 * tools bill nothing, so no billing mock is exercised) into the REAL frame
 * emitter. Pins:
 *   1. opt-in only — without `workspaceTools` the manifest does not offer the
 *      tools and no `action` frame can exist;
 *   2. with opt-in, a set_window call emits exactly one distinct `action`
 *      frame carrying the typed WorkspaceAction, after the `tool` frame and
 *      before the composition round;
 *   3. existing frames are unchanged in shape and order;
 *   4. a bad-args workspace call (a window the mirror does not offer) emits NO
 *      action frame — the model gets the structured arg error instead.
 */

import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

// deductBalance would touch Supabase for billed tools; workspace tools are
// free (capabilityId null) so it must never be called — mocked to prove that.
vi.mock("@/lib/agent/billing", () => ({
  deductBalance: vi.fn(async () => undefined),
}));

import { deductBalance } from "@/lib/agent/billing";
import { runChatAgentStream } from "@/lib/chat/agent-runner";
import type { ChatStreamEvent } from "@/lib/chat/stream-events";

function toolRound(name: string, args: Record<string, unknown>) {
  return async function* () {
    yield {
      id: "cmpl-1",
      model: "kimi-test",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_ws1",
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    };
    yield {
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "tool_calls",
          usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
        },
      ],
    };
  };
}

async function* finalRound() {
  yield { choices: [{ index: 0, delta: { role: "assistant", content: "Switched? The workspace will confirm." } }] };
  yield {
    choices: [],
    usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 },
  };
}

function fakeOpenAI(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const BASE_OPTS = {
  userMessages: [{ role: "user" as const, content: "Switch to a 1 year window" }],
  model: "kimi-test",
  userId: "user-1",
  requestId: "req-1",
};

describe("agent loop × workspace tools (real executor, scripted provider)", () => {
  it("emits one distinct `action` frame per successful workspace tool call", async () => {
    const create = vi
      .fn()
      .mockImplementationOnce(async () => toolRound("set_window", { preset: "1y" })())
      .mockImplementationOnce(async () => finalRound());

    const events: ChatStreamEvent[] = [];
    await runChatAgentStream(
      { ...BASE_OPTS, openai: fakeOpenAI(create), workspaceTools: true },
      (e) => events.push(e),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "status", // round 0
      "status", // Running set_window
      "tool",
      "action",
      "status", // composition round
      "delta",
      "final",
    ]);

    const action = events.find(
      (e): e is Extract<ChatStreamEvent, { type: "action" }> => e.type === "action",
    )!;
    expect(action.tool_call_id).toBe("call_ws1");
    expect(action.action).toEqual({ type: "set_window", window: { preset: "1y" } });

    // The workspace tool is free: the billing path must never be touched.
    expect(vi.mocked(deductBalance)).not.toHaveBeenCalled();

    // The manifest offered set_window because of the opt-in.
    const offered = (create.mock.calls[0][0].tools as { function: { name: string } }[]).map(
      (t) => t.function.name,
    );
    expect(offered).toContain("set_window");
    expect(offered).toContain("set_subject");
  });

  it("without the opt-in, workspace tools are not offered at all", async () => {
    const create = vi.fn().mockImplementationOnce(async () => finalRound());

    const events: ChatStreamEvent[] = [];
    await runChatAgentStream({ ...BASE_OPTS, openai: fakeOpenAI(create) }, (e) =>
      events.push(e),
    );

    expect(events.map((e) => e.type)).not.toContain("action");
    const offered = (create.mock.calls[0][0].tools as { function: { name: string } }[]).map(
      (t) => t.function.name,
    );
    expect(offered).not.toContain("set_window");
    expect(offered).not.toContain("set_subject");
  });

  it("a window the mirror does not offer produces an arg error, never an action frame", async () => {
    const create = vi
      .fn()
      // The strict schema should prevent this, but the executor is the last
      // line: "3y" is not a preset the bus performs.
      .mockImplementationOnce(async () => toolRound("set_window", { preset: "3y" })())
      .mockImplementationOnce(async () => finalRound());

    const events: ChatStreamEvent[] = [];
    const result = await runChatAgentStream(
      { ...BASE_OPTS, openai: fakeOpenAI(create), workspaceTools: true },
      (e) => events.push(e),
    );

    expect(events.map((e) => e.type)).not.toContain("action");
    expect(result.toolCallResults[0].error).toBe("Invalid arguments");
  });
});
