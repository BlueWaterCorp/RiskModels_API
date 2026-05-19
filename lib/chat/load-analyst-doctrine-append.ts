import fs from "fs";

/** Marker in BWMACRO-sourced doctrine markdown; replaced at runtime with Tools + Performance sections. */
export const ANALYST_PROMPT_TOOLS_PLACEHOLDER = "{{TOOLS_AND_PERFORMANCE}}";

const MINIMAL_OPERATIONAL_DOCTRINE = `## Operational baseline (full institutional doctrine not loaded)

Configure **ANALYST_SYSTEM_PROMPT_APPEND** (multiline) or **ANALYST_SYSTEM_PROMPT_APPEND_PATH** (file path) in deployment — source file: \`BWMACRO/docs/architecture/intelligence_runtime/chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md\`.

Until then:
- **Not an investment adviser:** report model outputs and hedge ratios as math only; never prescribe trades, hedges, or suitability; never reason about personal circumstances.
- **No fabrication:** never invent holdings, weights, or metrics — call tools for live data before stating figures.
- **Contract:** HR = dollar_ratio per SEMANTIC_ALIASES; ER at L3 are variance fractions (0–1). Negative HRs can arise from orthogonalization at L2/L3 — do not equate negative \`l3_market_hr\` with “negative market exposure”; use \`*_er\` for variance share at each layer.
- **Hedge-question routing:** when the user asks how to hedge a position (or what the L3 hedge looks like), use \`get_hedge_basket\` and render \`legs[]\` as a 4-row table (stock + SPY + sector ETF + subsector ETF) with the per-leg \`market_beta_contribution\` column and the \`net_market_beta_after_hedge\` subtotal. Show \`recommended_hedge_level\` and quote the \`decision_trace\` lines verbatim — they explain why the recommendation differs from \`lstar\` (when it does). Do NOT render \`l3_mkt_hr\` as a single number labeled "Market HR" — readers mistake the cascade-composed value (~-2 for AAPL) for a raw beta of 2.0.
`;

/**
 * Loads institutional analyst doctrine from env (BWMACRO markdown synced at deploy).
 * - ANALYST_SYSTEM_PROMPT_APPEND: raw markdown string (e.g. Doppler multiline).
 * - ANALYST_SYSTEM_PROMPT_APPEND_PATH: absolute or cwd-relative path to a UTF-8 file.
 * Path wins if both are set (path read last — actually prefer: explicit string over path if both? Standard: if APPEND non-empty use it, else read PATH.)
 */
export function loadAnalystDoctrineAppendRaw(): string | null {
  const inline = process.env.ANALYST_SYSTEM_PROMPT_APPEND?.trim();
  if (inline) return inline;

  const p = process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH?.trim();
  if (!p) return null;

  try {
    return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").trimEnd();
  } catch {
    console.error(
      "[analyst-doctrine] Failed to read ANALYST_SYSTEM_PROMPT_APPEND_PATH:",
      p,
    );
    return null;
  }
}

export function getMinimalOperationalDoctrine(): string {
  return MINIMAL_OPERATIONAL_DOCTRINE;
}
