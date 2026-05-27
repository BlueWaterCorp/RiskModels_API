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
- **Residual-return routing:** when the user asks for "the residual", "the idiosyncratic return", or "what's left after hedging", prefer \`lstar_rr\` over \`l3_rr\`. \`lstar_rr\` is the residual at the level Lstar actually picked for that name (L1/L2/L3 dispatched at the canonical 1% marginal-ER threshold); \`l3_rr\` is the fixed L3-subsector residual regardless of whether subsector hedging is statistically warranted. For names where \`lstar_level\` is 1 or 2, \`l3_rr\` overstates the cleanness of the residual. Show \`lstar_level\` (1/2/3 or null) alongside \`lstar_rr\` so the reader sees which level Lstar dispatched to. For a custom threshold use \`get_lstar(threshold=...)\` instead.
- **Panel / batch endpoint routing:** prefer one cross-section call over N per-ticker calls when the question shape allows.
  - "Show me the full decomposition for X" → \`get_returns_decomposition(ticker=X, include_lstar=True)\` returns gross + L1/L2/L3 CFR/FR/RR in one shot. Use \`get_metrics(X)\` only when the user wants the latest scalar snapshot.
  - "Which industries are most dispersed / are rotating in β?" → \`get_industry_panel(level="subsector", min_peers=20)\` returns the Vasicek peer-β cross-section. The right tool for macro / sector-rotation questions — do **not** loop \`get_metrics\` over tickers to reconstruct industry stats.
  - "Find names where residual / market-cap / ER is top decile" → \`screen_rankings(metric=..., cohort=..., window=..., min_percentile=...)\` runs the filter server-side and returns rows sorted by \`rank_ordinal\`. Do **not** loop \`get_rankings\` per ticker for cross-sectional screens.
  - "Lstar history for these N tickers" → \`batch_lstar(tickers=[...], years=...)\` (1 call, 25% cheaper) instead of N \`get_lstar(...)\` calls. \`batch_lstar_to_dataframes()\` splits the JSON map into per-ticker frames.
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
