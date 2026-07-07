import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { executeToolCalls, type ToolCallResult } from "@/lib/chat/tool-executor";

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
  /** Reject tool calls whose args fail this gate (e.g. non-MAG7 ticker). */
  preFlightGuard?: (toolName: string, parsedArgs: unknown) => string | null;
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

export function modelSupportsParallelToolCalls(model: string): boolean {
  const m = model.toLowerCase();
  if (m.startsWith("o1") || m.startsWith("o3")) return false;
  return true;
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
    preFlightGuard,
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
    let completion;
    try {
      completion = await openai.chat.completions.create({
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
      });
    } catch (e) {
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

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls?.length) {
      finalContent = assistantMessage.content ?? "";
      break;
    }

    const results = await executeToolCalls(toolCalls, {
      parallel: execParallel,
      userId,
      requestId,
      skipBilling,
      preFlightGuard,
    });

    for (const r of results) {
      toolCallResults.push(r);
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
