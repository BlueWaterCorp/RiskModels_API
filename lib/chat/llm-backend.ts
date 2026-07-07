import OpenAI from "openai";

/**
 * Resolves which LLM backend the tool-calling chat agent should use.
 *
 * Moonshot (Kimi) replaced OpenAI entirely (2026-07-07, after the OpenAI quota
 * exhaustion): it is OpenAI-compatible and cheaper, so it serves as the only
 * OpenAI-protocol backend for both the full analyst (/api/chat) and the keyless
 * MAG7 demo (/api/landing/chat). Billing to the end user is unchanged — that's
 * priced per RiskModels capability, not per upstream model — so this only
 * lowers our own inference cost.
 *
 * Precedence:
 *   1. An explicit `claude-*` requested model → Anthropic (runner dispatches on
 *      the `claude-` prefix; lets a specific caller force Claude).
 *   2. MOONSHOT_API_KEY set → Moonshot (Kimi), via an OpenAI client pointed at
 *      the Moonshot base URL. Non-Claude requested ids that aren't kimi/moonshot
 *      models resolve to the default Kimi model (there is no OpenAI backend).
 *   3. else → Claude default.
 *
 * Env (Doppler):
 *   MOONSHOT_API_KEY   — the Moonshot key (enables this backend when set)
 *   MOONSHOT_MODEL     — Kimi model id (default kimi-k2.5)
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
  if (moonshotKey) {
    const moonshotClient = new OpenAI({
      apiKey: moonshotKey,
      baseURL: process.env.MOONSHOT_BASE_URL?.trim() || "https://api.moonshot.ai/v1",
    });
    const defaultModel = process.env.MOONSHOT_MODEL?.trim() || "kimi-k2.5";
    // Honor explicit kimi/moonshot ids; anything else (legacy gpt-* callers)
    // resolves to the default Kimi model — there is no OpenAI backend anymore.
    const isKimi = req ? /^(kimi|moonshot)/i.test(req) : false;
    return {
      model: isKimi && req ? req : defaultModel,
      openai: moonshotClient,
      allowParallel: false,
      omitParallelToolCalls: true,
    };
  }

  // No Moonshot key → Claude is the only remaining backend.
  return { model: "claude-sonnet-4-6", allowParallel: true, omitParallelToolCalls: false };
}

/** True when any usable chat backend is configured. */
export function hasChatBackend(): boolean {
  return Boolean(
    process.env.MOONSHOT_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim(),
  );
}
