/**
 * Event vocabulary for the streaming chat engine (versioned, additive).
 *
 * `runChatAgentStream(opts, emit)` produces these events; the SSE transport in
 * POST /api/chat serializes them 1:1 as `event: <type>` frames. Consumers must
 * ignore unknown event types and unknown payload fields (additive evolution).
 *
 * P1 semantics:
 *  - `status`  — round start + per tool-call start.
 *  - `tool`    — each tool completes (tool execution is always blocking).
 *  - `delta`   — provider token deltas. Only the final composition round
 *    produces text with our tool-calling providers, so deltas effectively
 *    stream the final answer; if a tool round emits preamble text it is
 *    forwarded as narration and `final.content` remains authoritative.
 *  - `action`  — a typed workspace command (G.36): emitted per successful
 *    workspace-action tool call, only when the request opted in via
 *    `workspace_tools: true`. Distinct frame type by design — existing frames
 *    are unchanged and `.net` proxies everything verbatim; the workspace
 *    client feeds `action` to its command bus (`dispatchWorkspaceAction`,
 *    fail-closed) and non-workspace consumers ignore the unknown type.
 *  - `final`   — exactly once on success. `content` is authoritative (clients
 *    replace accumulated deltas with it). `quota` / `persisted_id` are
 *    engine-level null; the route enriches `quota`, and turn persistence is a
 *    consumer concern in P1 (`persisted_id` stays null).
 *  - `error`   — terminal failure; no `final` follows.
 */

export interface ToolCallSummaryEntry {
  tool: string;
  capability: string | null;
  cost_usd: number;
  latency_ms: number;
  error: string | null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatQuota {
  tokens_consumed: number;
  tokens_remaining: number | null;
}

export type ChatStreamEvent =
  | { type: "status"; round: number; message: string }
  | { type: "tool"; name: string; latency_ms: number; error?: string }
  | { type: "delta"; text: string }
  | { type: "action"; tool_call_id: string; action: Record<string, unknown> }
  | {
      type: "final";
      content: string;
      tool_calls_summary: ToolCallSummaryEntry[] | null;
      usage: ChatUsage;
      quota: ChatQuota | null;
      persisted_id: string | null;
    }
  | { type: "error"; status: number; message: string };

export type ChatStreamEmit = (event: ChatStreamEvent) => void;

/** Serialize one event as an SSE frame (`event:` = type, `data:` = payload sans type). */
export function encodeSseEvent(event: ChatStreamEvent): string {
  const { type, ...payload } = event;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Shared round-start status copy so both provider runners emit identical text. */
export function roundStatusMessage(round: number): string {
  return round === 0 ? "Analyzing request" : "Composing response";
}
