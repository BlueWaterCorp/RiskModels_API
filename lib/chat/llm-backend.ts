import OpenAI from "openai";

/**
 * Resolves which LLM backend the tool-calling chat agent should use.
 *
 * Moonshot (Kimi) is OpenAI-compatible and cheaper, so when MOONSHOT_API_KEY is
 * present it becomes the default backend for both the full analyst (/api/chat)
 * and the keyless MAG7 demo (/api/landing/chat). Billing to the end user is
 * unchanged — that's priced per RiskModels capability, not per upstream model —
 * so this only lowers our own inference cost.
 *
 * Precedence:
 *   1. An explicit `claude-*` requested model → Anthropic (runner dispatches on
 *      the `claude-` prefix; lets a specific caller force Claude).
 *   2. MOONSHOT_API_KEY set → Moonshot (Kimi), via an OpenAI client pointed at
 *      the Moonshot base URL.
 *   3. AGENT_BACKEND=claude → Claude default.
 *   4. else → OpenAI (requested model or gpt-4o-mini).
 *
 * Env (Doppler):
 *   MOONSHOT_API_KEY   — the Moonshot key (enables this backend when set)
 *   MOONSHOT_MODEL     — Kimi model id (default kimi-k2-0711-preview)
 *   MOONSHOT_BASE_URL  — override (default https://api.moonshot.ai/v1)
 */
export interface AgentBackend {
  model: string;
  /** Custom OpenAI-compatible client (Moonshot). Undefined → runner's default OpenAI/Anthropic. */
  openai?: OpenAI;
  allowParallel: boolean;
  /** Moonshot: don't send parallel_tool_calls at all (tool_choice=required is unsupported; keep the wire minimal). */
  omitParallelToolCalls: boolean;
}

export function resolveAgentBackend(requestedModel?: string): AgentBackend {
  const req = requestedModel?.trim();

  // Explicit Claude model always routes to Anthropic.
  if (req?.startsWith("claude-")) {
    return { model: req, allowParallel: true, omitParallelToolCalls: false };
  }

  const moonshotKey = process.env.MOONSHOT_API_KEY?.trim();
  const moonshotClient = moonshotKey
    ? new OpenAI({
        apiKey: moonshotKey,
        baseURL: process.env.MOONSHOT_BASE_URL?.trim() || "https://api.moonshot.ai/v1",
      })
    : undefined;

  // An explicit non-Claude model is honored: kimi/moonshot ids route through the
  // Moonshot client (when configured); anything else through the default OpenAI.
  if (req) {
    const isKimi = /^(kimi|moonshot)/i.test(req);
    return {
      model: req,
      openai: isKimi ? moonshotClient : undefined,
      allowParallel: !isKimi,
      omitParallelToolCalls: isKimi,
    };
  }

  // Default backend (no model requested):
  //   Moonshot when configured → cheapest;
  //   else Claude when its key is present (configured + working today);
  //   else OpenAI.
  if (moonshotClient) {
    return {
      model: process.env.MOONSHOT_MODEL?.trim() || "kimi-k2-0711-preview",
      openai: moonshotClient,
      allowParallel: false,
      omitParallelToolCalls: true,
    };
  }
  if (
    process.env.AGENT_BACKEND?.toLowerCase() === "claude" ||
    process.env.ANTHROPIC_API_KEY?.trim()
  ) {
    return { model: "claude-sonnet-4-6", allowParallel: true, omitParallelToolCalls: false };
  }
  return { model: "gpt-4o-mini", allowParallel: true, omitParallelToolCalls: false };
}

/** True when any usable chat backend is configured. */
export function hasChatBackend(): boolean {
  return Boolean(
    process.env.MOONSHOT_API_KEY?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
}
