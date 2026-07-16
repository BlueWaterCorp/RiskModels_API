import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { executeToolCalls, type ToolCallResult } from "@/lib/chat/tool-executor";
import {
  roundStatusMessage,
  type ChatStreamEmit,
  type ToolCallSummaryEntry,
} from "@/lib/chat/stream-events";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunChatAgentOptions {
  userMessages: AgentMessage[];
  model: string;
  userId: string;
  requestId: string;
  maxToolRounds?: number;
  maxCompletionTokens?: number;
  allowedToolNames?: readonly string[];
  execParallel?: boolean;
  allowParallelOpenAI?: boolean;
  /** Omit the `parallel_tool_calls` param entirely (OpenAI-compatible providers like Moonshot that don't accept it). */
  omitParallelToolCalls?: boolean;
  openai?: OpenAI;
  /** Skip per-tool deductBalance (keyless demo). */
  skipBilling?: boolean;
  /** Serve raw close/market cap (Exhibit B(e): authenticated callers only). */
  rawFieldsPermitted?: boolean;
  /** Reject tool calls whose args fail this gate (e.g. non-MAG7 ticker). */
  preFlightGuard?: (toolName: string, parsedArgs: unknown) => string | null;
  /** Optional cancellation; checked between rounds and passed to provider round-trips. */
  signal?: AbortSignal;
}

export interface RunChatAgentResult {
  finalContent: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  toolCallResults: ToolCallResult[];
}

export class AgentUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentUpstreamError";
  }
}

export class AgentAbortError extends Error {
  constructor() {
    super("Chat agent run aborted");
    this.name = "AgentAbortError";
  }
}

export function modelSupportsParallelToolCalls(model: string): boolean {
  const m = model.toLowerCase();
  if (m.startsWith("o1") || m.startsWith("o3")) return false;
  return true;
}

/** Map ToolCallResults to the wire summary shape shared by both response modes. */
export function summarizeToolCalls(
  results: ToolCallResult[],
): ToolCallSummaryEntry[] | null {
  if (results.length === 0) return null;
  return results.map((r) => ({
    tool: r.name,
    capability: r.capability_id,
    cost_usd: r.cost_usd,
    latency_ms: r.latency_ms,
    error: r.error ?? null,
  }));
}

/**
 * Run the tool-calling agent loop. Shared by POST /api/chat (billed) and
 * POST /api/landing/chat (keyless MAG7 demo).
 *
 * Dispatches by `model` prefix:
 *   - `claude-*`  → Anthropic Messages API runner (lib/chat/anthropic-agent.ts)
 *   - otherwise    → OpenAI tool loop (this function below)
 *
 * Both runners implement the same RunChatAgentOptions / RunChatAgentResult
 * contract and share `executeToolCalls()` for billing + idempotency, so dispatch
 * is transparent to callers (route, landing demo, internal tools).
 */
export async function runChatAgent(
  opts: RunChatAgentOptions,
): Promise<RunChatAgentResult> {
  if (opts.model.startsWith("claude-")) {
    const { runAnthropicChatAgent } = await import("@/lib/chat/anthropic-agent");
    return runAnthropicChatAgent(opts);
  }
  return runOpenAIChatAgent(opts);
}

/**
 * Streaming twin of `runChatAgent`: same options, same result, plus an `emit`
 * callback receiving the ChatStreamEvent vocabulary. Both entry points run the
 * SAME provider loop (`runOpenAIChatAgent` / `runAnthropicChatAgent`) — the
 * only difference is that with `emit` present each provider round-trip uses the
 * provider's token streaming and forwards text as `delta` events.
 *
 * Tool execution stays blocking (P1). `final` / `error` are emitted here, once,
 * regardless of provider path, so the runners cannot drift on terminal events.
 * `final.quota` / `final.persisted_id` are null at engine level — the transport
 * layer (route) enriches quota; turn persistence is a consumer concern in P1.
 */
export async function runChatAgentStream(
  opts: RunChatAgentOptions,
  emit: ChatStreamEmit,
): Promise<RunChatAgentResult> {
  let result: RunChatAgentResult;
  try {
    if (opts.model.startsWith("claude-")) {
      const { runAnthropicChatAgent } = await import(
        "@/lib/chat/anthropic-agent"
      );
      result = await runAnthropicChatAgent(opts, emit);
    } else {
      result = await runOpenAIChatAgent(opts, emit);
    }
  } catch (e) {
    if (e instanceof AgentAbortError) {
      emit({ type: "error", status: 499, message: e.message });
    } else if (e instanceof AgentUpstreamError) {
      emit({ type: "error", status: 502, message: e.message });
    } else {
      emit({
        type: "error",
        status: 500,
        message: e instanceof Error ? e.message : "Chat agent failed",
      });
    }
    throw e;
  }
  emit({
    type: "final",
    content: result.finalContent,
    tool_calls_summary: summarizeToolCalls(result.toolCallResults),
    usage: result.usage,
    quota: null,
    persisted_id: null,
  });
  return result;
}

interface StreamedRound {
  message: ChatCompletionAssistantMessageParam;
  toolCalls: ChatCompletionMessageToolCall[];
  usage: CompletionUsage | null;
  model: string;
}

/**
 * One provider round with `stream: true`: forward content deltas via `emit`,
 * accumulate tool-call deltas into complete ChatCompletionMessageToolCalls.
 *
 * Usage is read from `chunk.usage` (OpenAI `stream_options.include_usage`
 * shape) or `chunk.choices[0].usage` (Moonshot puts usage on the last chunk's
 * choice). Once tool-call deltas appear the round is a tool round — content
 * deltas stop being forwarded (P1: tool rounds are blocking; any preamble text
 * already forwarded is narration and `final.content` stays authoritative).
 */
async function streamOneOpenAIRound(
  openai: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  emit: ChatStreamEmit,
  signal?: AbortSignal,
): Promise<StreamedRound> {
  const stream = await openai.chat.completions.create(
    // Moonshot rejects some optional params; keep the wire identical to the
    // blocking round except for the stream flag itself.
    { ...params, stream: true },
    signal ? { signal } : undefined,
  );

  let content = "";
  let model = "";
  let usage: CompletionUsage | null = null;
  let sawToolCalls = false;
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of stream) {
    if (chunk.model) model = chunk.model;
    const choice = chunk.choices?.[0];
    const chunkUsage =
      chunk.usage ?? (choice as { usage?: CompletionUsage } | undefined)?.usage;
    if (chunkUsage) usage = chunkUsage;
    const delta = choice?.delta;
    if (!delta) continue;

    if (delta.tool_calls?.length) {
      sawToolCalls = true;
      for (const tc of delta.tool_calls) {
        const cur = toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolAcc.set(tc.index, cur);
      }
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      if (!sawToolCalls) emit({ type: "delta", text: delta.content });
    }
  }

  const toolCalls: ChatCompletionMessageToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id,
      type: "function" as const,
      function: { name: t.name, arguments: t.args },
    }));

  return {
    message: {
      role: "assistant",
      content: content.length > 0 ? content : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    toolCalls,
    usage,
    model,
  };
}

/**
 * OpenAI-compatible tool loop (Moonshot/Kimi). Blocking and streaming modes
 * share this single loop: with `emit` absent every round uses a plain
 * completion (byte-identical to the historical behavior); with `emit` present
 * each round streams and text deltas are forwarded live.
 */
async function runOpenAIChatAgent(
  opts: RunChatAgentOptions,
  emit?: ChatStreamEmit,
): Promise<RunChatAgentResult> {
  const {
    userMessages,
    model,
    userId,
    requestId,
    maxToolRounds = 5,
    maxCompletionTokens,
    allowedToolNames,
    execParallel = true,
    allowParallelOpenAI = true,
    omitParallelToolCalls = false,
    skipBilling = false,
    rawFieldsPermitted = false,
    preFlightGuard,
    signal,
  } = opts;

  // Moonshot (Kimi) is the only OpenAI-compatible backend; callers normally
  // pass the client from resolveAgentBackend(), this is the direct-call fallback.
  const moonshotKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!opts.openai && !moonshotKey) {
    throw new AgentUpstreamError("MOONSHOT_API_KEY is not configured");
  }
  const openai =
    opts.openai ??
    new OpenAI({
      apiKey: moonshotKey,
      baseURL: process.env.MOONSHOT_BASE_URL?.trim() || "https://api.moonshot.ai/v1",
    });

  const tools: ChatCompletionTool[] = allowedToolNames
    ? CHAT_TOOLS.filter(
        (t) => t.type === "function" && allowedToolNames.includes(t.function.name),
      )
    : CHAT_TOOLS;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...userMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const parallelOpenAI =
    modelSupportsParallelToolCalls(model) && allowParallelOpenAI;

  const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const toolCallResults: ToolCallResult[] = [];
  let finalContent = "";
  let finalModel = model;

  for (let round = 0; round < maxToolRounds; round++) {
    if (signal?.aborted) throw new AgentAbortError();
    emit?.({ type: "status", round, message: roundStatusMessage(round) });

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model,
        messages,
        tools,
        tool_choice: "auto",
        ...(omitParallelToolCalls
          ? {}
          : parallelOpenAI
            ? { parallel_tool_calls: true }
            : { parallel_tool_calls: false }),
        ...(maxCompletionTokens ? { max_tokens: maxCompletionTokens } : {}),
      };

    let toolCalls: ChatCompletionMessageToolCall[] | undefined;

    if (emit) {
      let streamed: StreamedRound;
      try {
        streamed = await streamOneOpenAIRound(openai, requestParams, emit, signal);
      } catch (e) {
        if (signal?.aborted) throw new AgentAbortError();
        const msg = e instanceof Error ? e.message : "OpenAI request failed";
        throw new AgentUpstreamError(msg);
      }
      if (streamed.usage) {
        totalUsage.prompt_tokens += streamed.usage.prompt_tokens;
        totalUsage.completion_tokens += streamed.usage.completion_tokens;
        totalUsage.total_tokens += streamed.usage.total_tokens;
      }
      if (streamed.model) finalModel = streamed.model;

      messages.push(streamed.message);
      toolCalls = streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined;
      if (!toolCalls) {
        finalContent =
          typeof streamed.message.content === "string"
            ? streamed.message.content
            : "";
        break;
      }
    } else {
      let completion;
      try {
        completion = await openai.chat.completions.create(
          requestParams,
          signal ? { signal } : undefined,
        );
      } catch (e) {
        if (signal?.aborted) throw new AgentAbortError();
        const msg = e instanceof Error ? e.message : "OpenAI request failed";
        throw new AgentUpstreamError(msg);
      }

      if (completion.usage) {
        totalUsage.prompt_tokens += completion.usage.prompt_tokens;
        totalUsage.completion_tokens += completion.usage.completion_tokens;
        totalUsage.total_tokens += completion.usage.total_tokens;
      }
      finalModel = completion.model;

      const choice = completion.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      toolCalls = assistantMessage.tool_calls;
      if (!toolCalls?.length) {
        finalContent = assistantMessage.content ?? "";
        break;
      }
    }

    if (emit) {
      for (const tc of toolCalls) {
        if (tc.type === "function") {
          emit({ type: "status", round, message: `Running ${tc.function.name}` });
        }
      }
    }

    const results = await executeToolCalls(toolCalls, {
      parallel: execParallel,
      userId,
      requestId,
      skipBilling,
      rawFieldsPermitted,
      preFlightGuard,
    });

    for (const r of results) {
      toolCallResults.push(r);
      emit?.({
        type: "tool",
        name: r.name,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      });
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const r = results[i];
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(r?.result ?? { error: "No result" }),
      });
    }
  }

  return {
    finalContent,
    model: finalModel,
    usage: totalUsage,
    toolCallResults,
  };
}
