import fs from "fs";

/** Marker in BWMACRO-sourced doctrine markdown; replaced at runtime with Tools + Performance sections. */
export const ANALYST_PROMPT_TOOLS_PLACEHOLDER = "{{TOOLS_AND_PERFORMANCE}}";

/**
 * The fallback the analyst runs on when no doctrine is configured.
 *
 * **This repository is public. Interpretation does not belong here.**
 *
 * The split, so the next person does not have to re-derive it:
 *
 * - **Contract is public.** What a field *is* — an HR is a dollar ratio, ER
 *   at L3 are variance fractions summing to ~1 — is API semantics. It is
 *   already in the OpenAPI spec, the SDK, the MCP mirror and the tool
 *   descriptions, and it has to be: a caller cannot use the API without it.
 * - **Interpretation is private.** Which of two valid measures to trust and
 *   why the other misleads, how a reader misreads a correct number, when to
 *   reach for which endpoint — that is judgment built from the model. It
 *   lives in `BWMACRO/docs/architecture/intelligence_runtime/chat_doctrine/
 *   ANALYST_SYSTEM_PROMPT_APPEND.md` and is injected at deploy.
 *
 * About twenty lines of the second kind sat in this constant until
 * 2026-08-03 (G.77): which residual measure to trust and why, the
 * hedge-basket rendering rules, the panel/batch routing table. Naming them
 * more precisely than that would put a little of it back. They arrived because the
 * private channel was never wired (G.76), so the nuance went where it would
 * actually run. All of it is in the private SSOT now; what remains here is
 * the guardrails that must survive a missing doctrine.
 *
 * `scripts/check-doctrine-boundary.sh` fails CI if interpretation returns.
 * Before adding a rule here, the question is not "is this useful?" but "does
 * a caller need it to use the API correctly?" If no, it belongs in private.
 */
const MINIMAL_OPERATIONAL_DOCTRINE = `## Operational baseline (full institutional doctrine not loaded)

The institutional analyst doctrine is not configured on this deployment, so what follows runs on guardrails alone — the interpretive layer is absent. Say so plainly if a user asks why an answer is thinner than they expected.

To load it, set **ANALYST_SYSTEM_PROMPT_APPEND** (multiline) or **ANALYST_SYSTEM_PROMPT_APPEND_PATH** (file path) in deployment. Source file: \`BWMACRO/docs/architecture/intelligence_runtime/chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md\`.

Until then:
- **Not an investment adviser:** report model outputs and hedge ratios as math only; never prescribe trades, hedges, or suitability; never reason about personal circumstances.
- **No fabrication:** never invent holdings, weights, or metrics — call tools for live data before stating figures. Decline honestly and offer what you can analyse instead.
- **Contract:** HR = dollar_ratio per SEMANTIC_ALIASES; ER at L3 are variance fractions (0–1). Hedge ratios may be negative, the market leg included — read variance share from \`*_er\`, never from the sign of an HR.
- **Formatting — no LaTeX:** chat surfaces do not render math markup. Never emit \`$...$\`, \`$$...$$\`, \`\\text\`, \`\\frac\`, or \`\\beta\`-style commands. Write formulas as plain text: \`CoE = rf + β × ERP\`. Reserve \`$\` for currency amounts only. Numbers in worked examples must come from THIS conversation's tool results — never reuse figures from earlier turns whose provenance you cannot restate.
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
