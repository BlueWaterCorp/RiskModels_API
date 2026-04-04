import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import { deductBalance } from "@/lib/agent/billing";
import { calculateRequestCost } from "@/lib/agent/capabilities";
import { TOOL_MAP, type ChatToolDef } from "@/lib/chat/tools";

export interface ToolCallResult {
  tool_call_id: string;
  name: string;
  result: unknown;
  cost_usd: number;
  capability_id: string | null;
  latency_ms: number;
  error?: string;
}

export interface ExecuteToolCallsOptions {
  /** When false, run tool calls one after another (default true). */
  parallel?: boolean;
  userId: string;
  requestId: string;
}

function structuredArgError(issues: { path: PropertyKey[]; message: string }[]) {
  return {
    error: "Invalid arguments",
    details: issues.map((i) => ({
      path: i.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number"),
      message: i.message,
    })),
    suggestion: "Check parameter types and required fields against the tool schema.",
  };
}

function isInsufficientBalance(err: unknown): boolean {
  return err instanceof Error && err.message === "Insufficient balance";
}

async function runOneTool(
  toolCall: ChatCompletionMessageToolCall,
  ctx: { userId: string; requestId: string },
): Promise<ToolCallResult> {
  const start = performance.now();
  const toolCallId = toolCall.id;
  if (toolCall.type !== "function") {
    return {
      tool_call_id: toolCallId,
      name: "unknown",
      result: { error: "Unsupported tool call type", suggestion: "Use function tools only." },
      cost_usd: 0,
      capability_id: null,
      latency_ms: Math.round(performance.now() - start),
      error: "Unsupported tool type",
    };
  }

  const name = toolCall.function.name;
  const def: ChatToolDef | undefined = TOOL_MAP[name];
  if (!def) {
    return {
      tool_call_id: toolCallId,
      name,
      result: { error: `Unknown tool: ${name}`, suggestion: "Use a defined RiskModels tool." },
      cost_usd: 0,
      capability_id: null,
      latency_ms: Math.round(performance.now() - start),
      error: `Unknown tool: ${name}`,
    };
  }

  let rawArgs: unknown = {};
  try {
    rawArgs = toolCall.function.arguments
      ? JSON.parse(toolCall.function.arguments)
      : {};
  } catch {
    rawArgs = {};
  }

  const parsed = def.argSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const result = structuredArgError(parsed.error.issues);
    console.warn("[chat-tool]", name, "validation_failed", parsed.error.message);
    return {
      tool_call_id: toolCallId,
      name,
      result,
      cost_usd: 0,
      capability_id: def.capabilityId,
      latency_ms: Math.round(performance.now() - start),
      error: "Invalid arguments",
    };
  }

  let result: unknown;
  try {
    result = await def.executor(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Tool execution failed";
    console.warn("[chat-tool]", name, "execute_error", msg);
    return {
      tool_call_id: toolCallId,
      name,
      result: {
        error: msg,
        suggestion:
          msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("symbol")
            ? "Try search_tickers to resolve the company name to a ticker."
            : "Verify inputs and try again.",
      },
      cost_usd: 0,
      capability_id: def.capabilityId,
      latency_ms: Math.round(performance.now() - start),
      error: msg,
    };
  }

  if (def.sanitizer) {
    try {
      result = def.sanitizer(result);
    } catch (e) {
      console.warn("[chat-tool]", name, "sanitizer_error", e);
    }
  }

  let costUsd = 0;
  if (def.capabilityId) {
    costUsd = calculateRequestCost(def.capabilityId);
    try {
      await deductBalance(ctx.userId, costUsd, ctx.requestId, def.capabilityId);
    } catch (err) {
      if (isInsufficientBalance(err)) {
        console.warn("[chat-tool]", name, "insufficient_balance");
        return {
          tool_call_id: toolCallId,
          name,
          result: {
            error: "Insufficient balance",
            suggestion:
              "You need more API credits to fetch this data. Visit https://riskmodels.app to top up.",
          },
          cost_usd: 0,
          capability_id: def.capabilityId,
          latency_ms: Math.round(performance.now() - start),
          error: "Insufficient balance",
        };
      }
      throw err;
    }
  }

  const latency_ms = Math.round(performance.now() - start);
  console.log(
    "[chat-tool]",
    JSON.stringify({ name, cost_usd: costUsd, latency_ms, capability_id: def.capabilityId }),
  );

  return {
    tool_call_id: toolCallId,
    name,
    result,
    cost_usd: costUsd,
    capability_id: def.capabilityId,
    latency_ms,
  };
}

/**
 * Execute OpenAI tool_calls: validate → execute → sanitize → bill (per tool).
 */
export async function executeToolCalls(
  toolCalls: ChatCompletionMessageToolCall[],
  options: ExecuteToolCallsOptions,
): Promise<ToolCallResult[]> {
  const { parallel = true, userId, requestId } = options;
  const ctx = { userId, requestId };

  if (!parallel) {
    const out: ToolCallResult[] = [];
    for (const tc of toolCalls) {
      out.push(await runOneTool(tc, ctx));
    }
    return out;
  }

  const settled = await Promise.allSettled(toolCalls.map((tc) => runOneTool(tc, ctx)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const tc = toolCalls[i];
    const id = tc?.id ?? "unknown";
    const name = tc?.type === "function" ? tc.function.name : "unknown";
    return {
      tool_call_id: id,
      name,
      result: {
        error: s.reason instanceof Error ? s.reason.message : "Tool call failed",
        suggestion: "Retry or simplify the request.",
      },
      cost_usd: 0,
      capability_id: TOOL_MAP[name]?.capabilityId ?? null,
      latency_ms: 0,
      error: "Rejected",
    };
  });
}
