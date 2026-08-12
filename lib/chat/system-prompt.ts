import { getChatToolReminderLines } from "@/lib/chat/tools";
import {
  ANALYST_PROMPT_TOOLS_PLACEHOLDER,
  getMinimalOperationalDoctrine,
  loadAnalystDoctrineAppendRaw,
} from "@/lib/chat/load-analyst-doctrine-append";

/**
 * Short OSS-safe shell — identity, date, pointer to public field contract.
 * Institutional doctrine is loaded from env (see BWMACRO chat_doctrine SSOT).
 */
export function buildPublicAnalystShell(date?: string): string {
  const today = date ?? new Date().toISOString().slice(0, 10);
  return `You are the RiskModels AI Risk Analyst — served from the RiskModels API (riskmodels.app). You have tools to fetch live US equity factor risk data from the ERM3 model.

Today's date (UTC): ${today}

Use **SEMANTIC_ALIASES** (riskmodels.app docs / SDK) for field names, units, and HR/ER meanings on API outputs. Extended interpretation and guardrails follow below.`;
}

function buildToolsAndPerformanceBlock(toolLines: string): string {
  return `## Tools (use them for live numbers)

${toolLines}

## Performance — fan out independent tool calls

The runtime executes **all tool calls in a single assistant turn concurrently** (they fan out server-side; the response waits only for the slowest one). So when your answer needs data for **multiple independent subjects** — several tickers, several metrics on the same ticker that aren't on the same tool, peer cohorts — emit **all** the tool calls **in one turn** (Anthropic supports multiple \`tool_use\` blocks per response). **Do not** fetch one ticker, await, then fetch the next on the following round — that serializes the latency unnecessarily.

Examples:
- User asks about one stock's risk / residual / vs peers → one \`get_stock_commentary_bundle\` call. Do not fan out \`get_risk_metrics\` + \`get_ticker_returns\` + \`get_rankings\` for that job.
- User asks "compare NVDA and AMD" → one \`compare_tickers\` call with both names. Do not emit \`get_risk_metrics\` once per ticker.
- User asks for a scalar snapshot on 8 independent holdings (not a comparison) → emit 8 \`get_risk_metrics\` calls in one turn (≈ one tool latency total, parallel).
- Reserve a *second* tool-round only when round 2's calls genuinely depend on round 1's results (e.g. you searched for a ticker by name and need to fetch metrics for the resolved symbol).

This matters: a serialized 8-call answer takes ≈ 8 × tool latency; a fan-out answer takes ≈ 1 × tool latency.`;
}

function mergeDoctrineAndTools(rawDoctrine: string, toolsBlock: string): string {
  if (rawDoctrine.includes(ANALYST_PROMPT_TOOLS_PLACEHOLDER)) {
    return rawDoctrine.split(ANALYST_PROMPT_TOOLS_PLACEHOLDER).join(toolsBlock);
  }
  console.warn(
    "[system-prompt] Doctrine markdown missing {{TOOLS_AND_PERFORMANCE}}; appending Tools+Performance at end (fix SSOT file).",
  );
  return `${rawDoctrine}\n\n${toolsBlock}`;
}

/**
 * System prompt for agentic chat.
 *
 * **Layers:** (1) public shell from this repo; (2) institutional doctrine from
 * `ANALYST_SYSTEM_PROMPT_APPEND` or `ANALYST_SYSTEM_PROMPT_APPEND_PATH` (SSOT:
 * BWMACRO `chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md`) with
 * `{{TOOLS_AND_PERFORMANCE}}` substitution; (3) if unset, minimal operational stub.
 *
 * Contract hooks from THE_ANALYST.md (BWMACRO): §2 non-advisor boundary;
 * TA.NMD.1 fabrication; TA.M7.3 Aha-first; TA.M7.1 fan-out — enforced in doctrine file.
 */
export function buildSystemPrompt(date?: string): string {
  const today = date ?? new Date().toISOString().slice(0, 10);
  const toolLines = getChatToolReminderLines().join("\n");
  const toolsPerf = buildToolsAndPerformanceBlock(toolLines);
  const shell = buildPublicAnalystShell(today);

  const rawDoctrine = loadAnalystDoctrineAppendRaw();
  const core = rawDoctrine
    ? mergeDoctrineAndTools(rawDoctrine, toolsPerf)
    : `${getMinimalOperationalDoctrine()}\n\n${toolsPerf}`;

  return `${shell}\n\n${core}`;
}
