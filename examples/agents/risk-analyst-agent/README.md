# Risk Analyst Agent (MCP + Python)

Reference agent that uses **RiskModels as the risk substrate** — L3 variance decomposition, ETF hedge ratios, fund/filer holdings, and deterministic artifact renders. This is the P0 “Agent Garden–style” example without hosting on Google Agent Engine: your orchestrator calls **riskmodels.app** tools; RiskModels owns the numbers.

## What you get

| Surface | Tool / entry |
|--------|----------------|
| **MCP** (Cursor, Claude Desktop, Codex) | `riskmodels_render_artifact`, `riskmodels_decompose`, `riskmodels_portfolio_decompose`, … |
| **Hosted MCP** | `https://riskmodels.app/api/mcp/sse` + Bearer key |
| **Chat on riskmodels.app** | Same tools via the API Risk Analyst (`render_artifact`, `get_risk_metrics`, …) |
| **Python SDK** | `riskmodels-py` — see [`../python/ai_risk_analyst.py`](../python/ai_risk_analyst.py) |

## Quick start (MCP)

```bash
export RISKMODELS_API_KEY=rm_agent_…   # https://riskmodels.app/get-key
npx -y riskmodels@latest install
# Claude Code also: claude mcp add --scope user --transport stdio riskmodels -- npx -y @riskmodels/mcp
```

Agent discovery: [https://riskmodels.app/llms.txt](https://riskmodels.app/llms.txt)

## Example workflow (fund)

1. `riskmodels` MCP: search / resolve fund → `BW-FUND-…`
2. `riskmodels_decompose` or `get_risk_metrics` (via chat) for scalar L3 metrics
3. `riskmodels_render_artifact` with `slug=top_holdings_erm_stacked`, `format=json`
4. Optional narratives: `narrative_profile`, `narrative_perf_insight`, `narrative_risk_insight`

```json
{
  "slug": "top_holdings_erm_stacked",
  "version": "v1",
  "subject_id": "BW-FUND-S000004563",
  "as_of": "latest",
  "format": "json"
}
```

## Example workflow (13F filer)

1. Resolve filer → `BW-FILER-…`
2. Render with **explicit** `as_of` (filing period end), e.g. `2026-03-31` for cache hits
3. Slugs: `top_holdings_erm_stacked`, `cumulative_return_strip`, `entity_header`, `risk_summary_panel`, …

## Architecture

```text
Your agent (Cursor / ADK local / custom loop)
    → MCP or REST on riskmodels.app
        → DAL / metrics / batch analyze
        → render-svc POST /artifacts/render (deterministic JSON/PNG)
```

**Do not** treat generic web search or LLM-drawn charts as risk truth. Artifacts are render-once; cite fields from the JSON payload.

## Analyst boundary (institutional)

RiskModels is an **analytical tool**, not an investment adviser. Agents should **show** hedge ratios and decomposition math, not prescribe trades. See BWMACRO `docs/architecture/intelligence_runtime/THE_ANALYST.md` §2.

## Ops

- **render-svc** must be deployed and `RENDER_SVC_URL` set on the API portal for `render_artifact` / `riskmodels_render_artifact` (see `services/render-svc/RUNBOOK.md`).
- Billing: capability `artifact-render` (~$0.05/request on the API meter).

## P1 note (not in this example)

Portfolio what-if, drift monitoring, and higher-level **bwmacro** skills are gated on a **premium** chat tier / API scope — define before expanding tool surface.
