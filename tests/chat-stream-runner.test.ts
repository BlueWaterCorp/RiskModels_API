import { describe, expect, it, vi, beforeEach } from "vitest";
import type OpenAI from "openai";

vi.mock("@/lib/chat/tool-executor", () => ({
  executeToolCalls: vi.fn(),
}));

import { executeToolCalls } from "@/lib/chat/tool-executor";
import {
  runChatAgent,
  runChatAgentStream,
  AgentUpstreamError,
} from "@/lib/chat/agent-runner";
import {
  encodeSseEvent,
  type ChatStreamEvent,
} from "@/lib/chat/stream-events";

const TOOL_RESULT = {
  tool_call_id: "call_1",
  name: "get_fundamentals",
  result: { symbol: "AAPL", wacc: 0.09 },
  cost_usd: 0.002,
  capability_id: "fundamentals",
  latency_ms: 42,
};

/** Round 1: model requests one tool via split argument deltas (Moonshot puts usage on the last chunk's choice). */
async function* toolRoundChunks() {
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
              id: "call_1",
              type: "function",
              function: { name: "get_fundamentals", arguments: '{"sym' },
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
        delta: {
          tool_calls: [{ index: 0, function: { arguments: 'bol":"AAPL"}' } }],
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
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
    ],
  };
}

/** Round 2: final composition round streams text; usage arrives OpenAI-style on the last chunk. */
async function* finalRoundChunks() {
  yield { choices: [{ index: 0, delta: { role: "assistant", content: "AAPL's " } }] };
  yield { choices: [{ index: 0, delta: { content: "cost of capital is " } }] };
  yield { choices: [{ index: 0, delta: { content: "9.0%." }, finish_reason: "stop" }] };
  yield {
    choices: [],
    usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  };
}

function fakeOpenAI(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const BASE_OPTS = {
  userMessages: [{ role: "user" as const, content: "What is AAPL's cost of capital?" }],
  model: "kimi-test",
  userId: "user-1",
  requestId: "req-1",
};

beforeEach(() => {
  vi.mocked(executeToolCalls).mockReset();
});

describe("runChatAgentStream — event sequence (OpenAI-compatible path)", () => {
  async function runGolden() {
    const create = vi
      .fn()
      .mockImplementationOnce(async () => toolRoundChunks())
      .mockImplementationOnce(async () => finalRoundChunks());
    vi.mocked(executeToolCalls).mockResolvedValue([TOOL_RESULT]);

    const events: ChatStreamEvent[] = [];
    const result = await runChatAgentStream(
      { ...BASE_OPTS, openai: fakeOpenAI(create) },
      (e) => events.push(e),
    );
    return { events, result, create };
  }

  it("emits status → tool → delta+ → exactly one final, in order", async () => {
    const { events } = await runGolden();
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "status", // round 0 start
      "status", // Running get_fundamentals
      "tool",
      "status", // round 1 start (composition)
      "delta",
      "delta",
      "delta",
      "final",
    ]);
    // Ordering invariants the eval harness also asserts:
    expect(types.indexOf("status")).toBeLessThan(types.indexOf("delta"));
    expect(types.filter((t) => t === "final")).toHaveLength(1);
    expect(types.at(-1)).toBe("final");
    expect(types).not.toContain("error");
  });

  it("final content equals the concatenated deltas and carries summary/usage", async () => {
    const { events, result } = await runGolden();
    const deltas = events
      .filter((e): e is Extract<ChatStreamEvent, { type: "delta" }> => e.type === "delta")
      .map((e) => e.text)
      .join("");
    const final = events.find(
      (e): e is Extract<ChatStreamEvent, { type: "final" }> => e.type === "final",
    )!;
    expect(final.content).toBe("AAPL's cost of capital is 9.0%.");
    expect(final.content).toBe(deltas);
    expect(final.tool_calls_summary).toEqual([
      {
        tool: "get_fundamentals",
        capability: "fundamentals",
        cost_usd: 0.002,
        latency_ms: 42,
        error: null,
      },
    ]);
    expect(final.usage).toEqual({
      prompt_tokens: 300,
      completion_tokens: 30,
      total_tokens: 330,
    });
    expect(final.quota).toBeNull();
    expect(final.persisted_id).toBeNull();
    // Returned result matches the blocking-path contract.
    expect(result.finalContent).toBe(final.content);
    expect(result.toolCallResults).toEqual([TOOL_RESULT]);
    expect(result.model).toBe("kimi-test");
  });

  it("reassembles split tool-call argument deltas before executing", async () => {
    await runGolden();
    expect(vi.mocked(executeToolCalls)).toHaveBeenCalledTimes(1);
    const [calls] = vi.mocked(executeToolCalls).mock.calls[0];
    expect(calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_fundamentals", arguments: '{"symbol":"AAPL"}' },
      },
    ]);
  });

  it("requests provider streaming only in stream mode", async () => {
    const { create } = await runGolden();
    for (const call of create.mock.calls) {
      expect(call[0].stream).toBe(true);
    }

    const blockingCreate = vi.fn().mockResolvedValue({
      model: "kimi-test",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      choices: [{ message: { role: "assistant", content: "hi" } }],
    });
    await runChatAgent({ ...BASE_OPTS, openai: fakeOpenAI(blockingCreate) });
    expect(blockingCreate.mock.calls[0][0].stream).toBeUndefined();
  });
});

describe("runChatAgentStream — error path", () => {
  it("emits a terminal 502 error event and rejects with AgentUpstreamError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("upstream boom"));
    const events: ChatStreamEvent[] = [];

    await expect(
      runChatAgentStream({ ...BASE_OPTS, openai: fakeOpenAI(create) }, (e) =>
        events.push(e),
      ),
    ).rejects.toBeInstanceOf(AgentUpstreamError);

    const types = events.map((e) => e.type);
    expect(types).toEqual(["status", "error"]);
    const err = events.at(-1) as Extract<ChatStreamEvent, { type: "error" }>;
    expect(err.status).toBe(502);
    expect(err.message).toContain("upstream boom");
    expect(types).not.toContain("final");
  });
});

describe("runChatAgentStream — abort path", () => {
  it("stops between rounds, emits error 499, no final", async () => {
    const controller = new AbortController();
    const create = vi.fn().mockImplementation(async () => toolRoundChunks());
    // Simulate the client dropping while the tool executes.
    vi.mocked(executeToolCalls).mockImplementation(async () => {
      controller.abort();
      return [TOOL_RESULT];
    });

    const events: ChatStreamEvent[] = [];
    await expect(
      runChatAgentStream(
        { ...BASE_OPTS, openai: fakeOpenAI(create), signal: controller.signal },
        (e) => events.push(e),
      ),
    ).rejects.toMatchObject({ name: "AgentAbortError" });

    const types = events.map((e) => e.type);
    expect(types.at(-1)).toBe("error");
    const err = events.at(-1) as Extract<ChatStreamEvent, { type: "error" }>;
    expect(err.status).toBe(499);
    expect(types).not.toContain("final");
    expect(create).toHaveBeenCalledTimes(1); // no second round after abort
  });
});

describe("encodeSseEvent", () => {
  it("frames the event type and payload without the type field", () => {
    expect(encodeSseEvent({ type: "delta", text: "hi" })).toBe(
      'event: delta\ndata: {"text":"hi"}\n\n',
    );
    expect(
      encodeSseEvent({ type: "status", round: 0, message: "Analyzing request" }),
    ).toBe('event: status\ndata: {"round":0,"message":"Analyzing request"}\n\n');
  });
});
