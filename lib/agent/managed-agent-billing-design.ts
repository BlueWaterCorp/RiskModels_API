/**
 * Design-only billing constants for a future Claude Managed Agents integration (Option B).
 * Not registered in capabilities.ts or OpenAPI until product ships hosted managed sessions.
 *
 * @see docs/ANTHROPIC_CLOUD_AGENTS.md
 */

export const MANAGED_AGENT_BILLING_DESIGN_IDS = {
  inputTokens: "managed-agent-input-tokens",
  outputTokens: "managed-agent-output-tokens",
  sessionMinute: "managed-agent-session-minute",
} as const;

/** Placeholder for margin analysis — replace with values from finance after spike */
export const MANAGED_AGENT_BILLING_DESIGN_NOTES = {
  /** Verify on https://docs.anthropic.com/en/docs/about-claude/pricing before quoting */
  anthropicPricingVerifyUrl:
    "https://docs.anthropic.com/en/docs/about-claude/pricing",
  /** RiskModels tool/MCP charges remain per existing capability IDs */
  riskmodelsToolsUnchanged: true,
} as const;
