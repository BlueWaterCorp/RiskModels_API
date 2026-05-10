import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { executeToolCalls } from "@/lib/chat/tool-executor";
import {
  AgentUpstreamError,
  type RunChatAgentOptions,
  type RunChatAgentResult,
} from "@/lib/chat/agent-runner";

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Translate an OpenAI function-calling tool to the Anthropic tool_use shape.
 * Both use JSON Schema for parameters — only the wrapper differs.
 */
function toAnthropicTool(t: ChatCompletionTool): Anthropic.Tool {
  if (t.type !== "function") {
    throw new AgentUpstreamError(`Unsupported tool type for Claude: ${t.type}`);
  }
  return {
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  };
}

/**
 * Wrap an Anthropic `tool_use` block in the OpenAI ChatCompletionMessageToolCall
 * shape so the existing `executeToolCalls()` path (billing, idempotency,
 * preflight guard) runs unchanged.
 *
 * Anthropic delivers `input` as a parsed object; the OpenAI executor expects
 * `arguments` as a JSON string. We re-serialize once here.
 */
function toolUseToFakeOpenAICall(
  block: Anthropic.ToolUseBlock,
): ChatCompletionMessageToolCall {
  return {
    id: block.id,
    type: "function",
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
    },
  };
}

/**
 * Run the tool-calling agent loop against Anthropic (Claude). Implements the
 * same RunChatAgentOptions / RunChatAgentResult contract as the OpenAI runner
 * in lib/chat/agent-runner.ts so dispatch is transparent to callers.
 *
 * Prompt caching: `cache_control: {type: "ephemeral"}` on the system prompt
 * caches the (frozen) tools + system together per the prefix-match rule
 * (tools render before system; breakpoint on last system block covers both).
 *
 * Thinking: defaults to disabled for chat workloads — single-tool-call
 * portfolio analysis doesn't benefit enough from adaptive thinking to justify
 * the token cost in trial mode. Effort `medium` is the cost/quality sweet spot.
 *
 * Models: dispatch is based on `model.startsWith("claude-")`; callers pass any
 * canonical alias from shared/models.md (e.g. claude-sonnet-4-6).
 */
export async function runAnthropicChatAgent(
  opts: RunChatAgentOptions,
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
    skipBilling = false,
    preFlightGuard,
  } = opts;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AgentUpstreamError("ANTHROPIC_API_KEY is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const selectedTools: ChatCompletionTool[] = allowedToolNames
    ? CHAT_TOOLS.filter(
        (t) =>
          t.type === "function" && allowedToolNames.includes(t.function.name),
      )
    : CHAT_TOOLS;
  const anthropicTools = selectedTools.map(toAnthropicTool);

  const messages: Anthropic.MessageParam[] = userMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  const toolCallResults: RunChatAgentResult["toolCallResults"] = [];
  let finalContent = "";
  let finalModel = model;

  for (let round = 0; round < maxToolRounds; round++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxCompletionTokens ?? DEFAULT_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: buildSystemPrompt(),
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: anthropicTools,
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        throw new AgentUpstreamError(
          `Anthropic API error (${e.status}): ${e.message}`,
        );
      }
      const msg = e instanceof Error ? e.message : "Anthropic request failed";
      throw new AgentUpstreamError(msg);
    }

    finalModel = response.model;
    totalUsage.prompt_tokens +=
      response.usage.input_tokens +
      (response.usage.cache_read_input_tokens ?? 0) +
      (response.usage.cache_creation_input_tokens ?? 0);
    totalUsage.completion_tokens += response.usage.output_tokens;
    totalUsage.total_tokens =
      totalUsage.prompt_tokens + totalUsage.completion_tokens;

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      finalContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    if (
      response.stop_reason !== "tool_use" &&
      response.stop_reason !== "pause_turn"
    ) {
      finalContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") {
      continue;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUseBlocks.length === 0) {
      finalContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    const fakeCalls = toolUseBlocks.map(toolUseToFakeOpenAICall);
    const results = await executeToolCalls(fakeCalls, {
      parallel: execParallel,
      userId,
      requestId,
      skipBilling,
      preFlightGuard,
    });
    for (const r of results) {
      toolCallResults.push(r);
    }

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(
      (block, i) => {
        const r = results[i];
        const content =
          typeof r?.result === "string"
            ? r.result
            : JSON.stringify(r?.result ?? { error: "No result" });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content,
          is_error: r?.error != null,
        };
      },
    );
    messages.push({ role: "user", content: toolResultBlocks });
  }

  return {
    finalContent,
    model: finalModel,
    usage: totalUsage,
    toolCallResults,
  };
}
