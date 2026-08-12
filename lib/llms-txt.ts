/**
 * Source body for https://riskmodels.app/llms.txt (served by app/llms.txt/route.ts).
 * Optional `LLMS_TXT_PUBLIC_AGENT_KEY` appends a shared sample Bearer token for LLM crawlers.
 */

import { WALKTHROUGH_MAG7_TICKERS } from "@/lib/landing/walkthrough-chart-data";
import { FIRST_LIVE_PROMPT_MCP, FIRST_LIVE_PROMPT_REST } from "@/lib/mcp/activation";

function mag7BulletList(): string {
  return WALKTHROUGH_MAG7_TICKERS.map((t) => `- ${t}`).join("\n");
}

function buildLlmsTxtBase(): string {
  const mag7Csv = WALKTHROUGH_MAG7_TICKERS.join(", ");
  return `# RiskModels (riskmodels.app)

RiskModels is an agent-friendly US equity risk API: hierarchical (L3) variance decomposition,
ETF hedge ratios, metrics, portfolio snapshots, and a hosted MCP surface.

**No sign-in yet?** If this host publishes a shared demo key, you will find it under **Public sample API key** below — use it as \`RISKMODELS_API_KEY\` / \`Authorization: Bearer …\` for MAG7 examples. That path is meant for browser agents that cannot run \`POST /api/auth/provision-free\`.

## If a human asks you to set up RiskModels

You are an AI assistant reading this because someone pointed you at riskmodels.app. There are two distinct requests — handle the one they made:

**1. "Set it up for this chat" / "help me analyze …"** — set yourself up now, in this conversation, with no install:
- Discovery docs (this file, the OpenAPI spec, and /.well-known/mcp.json) are free and need no key.
- For live data on the Magnificent 7, use the **Public sample API key** below (if present) as \`Authorization: Bearer …\`. If you can make HTTP POSTs, you may self-provision a free key: \`POST /api/auth/provision-free\`. For the full ~3,000-name universe, tell the human to grab a free key at https://riskmodels.app/get-key (browser, no terminal).
- Make one real call to confirm the connection: GET /api/metrics/AAPL (or POST /api/decompose with ticker AAPL). Quote residual explained-risk and the L3 hedge ratios from the JSON. Then tell the human what you can analyze. **Do not tell a human to open a terminal for this case. Do not start with a capability catalog.**

**2. "Help me set it up" / "add this to my Claude/Cursor/ChatGPT/Grok/Gemini"** — they want RiskModels available permanently. You cannot edit their app's config yourself, so relay these steps:
- **Claude Desktop / Cursor (recommended — no terminal, no API key):** **Settings → Connectors → Add custom connector**, paste \`https://riskmodels.app/api/mcp/sse\`, leave OAuth Client ID / Secret blank, **Add → Connect**. They sign in at riskmodels.app once (OAuth 2.0 + PKCE). After Connect, they should paste this into the chat (do not start with list_endpoints):

  ${FIRST_LIVE_PROMPT_MCP}
- **ChatGPT (Plus+ on web — Developer Mode):** **Settings → Apps & Connectors → Advanced settings → enable Developer mode**, then **Apps & Connectors → Create**, paste \`https://riskmodels.app/api/mcp/sse\`, choose **OAuth**, sign in at riskmodels.app. This is **not** the built-in Finances / Schwab connector. Guide: \`https://riskmodels.app/docs/agent-integration#chatgpt-mcp\`.
- **Grok (web / iOS / Android):** **grok.com/connectors → New Connector → Custom**, paste \`https://riskmodels.app/api/mcp/sse\`, OAuth sign-in at riskmodels.app. No Developer Mode. Guide: \`https://riskmodels.app/docs/agent-integration#grok-mcp\`.
- **Gemini consumer web (gemini.google.com):** no custom MCP UI — use case 1 (\`/llms.txt\` + REST in this chat). **Gemini CLI / Antigravity:** \`gemini mcp add --transport http riskmodels https://riskmodels.app/api/mcp/sse\` then \`/mcp auth riskmodels\`. **Gemini Enterprise:** admin registers Custom MCP data store in Google Cloud (Streamable HTTP + OAuth; may need pre-registered Client ID/Secret). Guide: \`https://riskmodels.app/docs/agent-integration#gemini\`.
- **ChatGPT + Schwab holdings without MCP:** If they already connected Finances, keep that for positions; paste tickers here and use case 1 (REST via this file) or \`POST /api/portfolio/risk-snapshot\` with weights.
- **Developer alternatives (terminal):** \`npm install -g riskmodels@latest\` then \`riskmodels install\`, or \`npx -y mcp-remote https://riskmodels.app/api/mcp/sse\` with \`AUTHORIZATION=Bearer <key>\`.

## Magnificent 7 (MAG7)

These seven US equities are the usual demo / smoke-test set (landing charts, optional public sample key, \`mag7=true\` on tickers):

${mag7BulletList()}

One-line form: **${mag7Csv}**. For Alphabet use **GOOG** in examples; **GOOGL** aliases to the same name in the API. The public JSON from \`GET /api/tickers?mag7=true\` may list **GOOGL**; both work with \`GET /api/metrics/{ticker}\` and related routes.

## Developer setup — CLI (human runs once in a terminal)

This is the developer path for case 2 above; non-technical humans should prefer the no-terminal connector.

- Install Node.js LTS (https://nodejs.org).
- Get an API key: https://riskmodels.app/get-key
- Run (pins the CLI so \`npx\` does not use a stale cache):

  RISKMODELS_API_KEY=… npx -y riskmodels@latest install

  Optional: add --dry-run first. The installer stores the key in ~/.config/riskmodels/config.json
  and merges the RiskModels MCP server into supported clients (Cursor, Claude Desktop, Codex, etc.).

## Claude Code (terminal \`claude\`) vs Claude Desktop

\`riskmodels install\` updates Claude Desktop and Cursor configs. The **Claude Code** CLI uses a
separate MCP store. After install, register RiskModels for Claude Code:

  claude mcp add --scope user --transport stdio riskmodels -- npx -y @riskmodels/mcp

Then restart \`claude\` and check \`claude mcp list\`. If the server does not connect, use the hosted
MCP URL with \`mcp-remote\` and AUTHORIZATION=Bearer … (see Quickstart / MCP README).

## Where to integrate without a local install

- **MCP discovery manifest:** https://riskmodels.app/.well-known/mcp.json (public JSON — paste URL into Claude/Cursor/Grok/ChatGPT connectors, or Gemini Enterprise admin console)
- **Agent integration guide:** https://riskmodels.app/docs/agent-integration (ChatGPT Developer Mode, Grok Connectors, Gemini CLI/Enterprise, Finances + holdings workflow)
- Hosted MCP (Streamable HTTP): https://riskmodels.app/api/mcp/sse — Bearer token, OAuth connector (Claude/Cursor/ChatGPT), or \`mcp-remote\` proxy. The MCP endpoint authenticates every call (including initialize); data tools bill per underlying REST route.
- OpenAPI: https://riskmodels.app/openapi.json (or /api-reference in the portal)
- Python SDK (PyPI): riskmodels-py — see https://riskmodels.app/installation

## Panel / batch endpoints — when one call beats many

The decomposition routes that work across the universe (or many tickers) in a single call:

- **\`GET /api/returns-decomposition?ticker=…&years=…&include_lstar=true\`** — daily gross + L1/L2/L3 factor / combined-factor / residual return series for one ticker, all in one response. Replaces six \`?metrics=l1_cfr,l1_rr,...\` round-trips. Add \`include_lstar=true\` for the Lstar-dispatched residual + level. **$0.02/call.**
- **\`GET /api/industry-panel?level=subsector&min_peers=20\`** — Vasicek peer-β cross-section by EODHD industry × cascade level: \`beta_mean\`, \`beta_variance\`, \`n_companies\`, \`total_log_mcap_weight\`. The macro / sector-rotation surface. One teo per call (latest by default). **$0.02/call.**
- **\`POST /api/rankings/screen\`** with \`{metric, cohort, window, min_percentile|decile|sector_filter, limit}\` — server-side rank filter over the full ds_rankings cross-section at one teo. Returns up to 500 rows sorted by \`rank_ordinal\` (1 = best). The stat-arb cross-section in one call — replaces N per-ticker \`/rankings\` calls. **$0.02/call.**
- **\`POST /api/batch/lstar\`** with \`{tickers: [...], years}\` — per-ticker daily Lstar history for up to 100 tickers in one call. Companion to \`lstar_rr\` in MetricsV3 (single-name latest); use this when you need history across a panel. **$0.005/ticker, min $0.01/call** (25% cheaper than repeated \`GET /lstar\`).
- **\`POST /api/signals/residual-reversion/basket\`** with \`{tickers: [...], weights?, signal_quality_min_quintile?}\` — aggregate the Phase D L3 residual mean-reversion signal across a user-supplied basket of up to 500 tickers. Returns weighted aggregate + decile / quality-quintile histograms + per-member rows. Equal-weight default; optional quality gate (Phase B: gross Sharpe lifts from ~0.79 to ~1.28 at quintile 5). Trust the zarr — tickers not in \`ds_erm3_residual_signal\` are silently dropped and surfaced via \`coverage.missing_tickers\`. **$0.02/call.**
- **\`GET /api/universe/{name}/members\`** — active membership of a named universe (\`uni_mc_3000\` etc.) at one teo (latest by default). Active = monthly universe_mask AND daily validity gate. Use this to align your screen / panel / book against the canonical universe without a local SDK cache. Response carries members + counts breakdown + a \`mask_as_of\` month-end stamp. **$0.005/call.**
- **\`GET /api/etf/factor-returns\`** — one-teo snapshot of close + trailing 1d / 21d / 63d / 252d total returns for **SPY + the 11 GICS sector SPDR ETFs** (XLE/XLB/XLI/XLY/XLP/XLV/XLF/XLK/XLC/XLU/XLRE). Public-scope only; tickers outside that set return 400. Pairs with \`industry-panel\` for the daily market + sector index read alongside aggregate stock-level industry βs. **$0.005/call.**
- **\`GET /api/cohorts\`** and **\`GET /api/cohorts/series\`** — cross-sectional residual statistics by cohort (SPY + the 11 GICS sector SPDRs) from \`ds_erm3_cohorts\`: \`residual_mean\`, \`residual_sd\`, \`residual_skew\`, \`residual_p10/p90\`, \`mean_pairwise_corr\`, \`n_names\`, \`n_effective\`, \`weight_top1\`, \`membership_churn\`, \`linked_beta\` (+se/r2/roll63), \`cohort_factor_return\`, \`cohort_residual_return\`, \`cohort_ER\`, \`factor_source\`. \`linked_beta_se\` is a CONDITIONAL, homoskedastic model SE — understated for daily returns and unreliable in partial windows (early history); not a total-uncertainty measure. Cross-section **$0.02/call**, series **$0.03/call**; \`GET /api/cohorts/roster\` is free discovery.

  **Residuals are not zero-mean.** ERM3 regressions are fitted *without an intercept*, deliberately, so each stock's residual retains its alpha — the cross-sectional mean is **not zero**. Before building any relative-ranking signal, subtract \`residual_mean\` at the level your residual is defined against (sector residuals demean within sector cohorts). Never quote a drift figure without its window; the sign is not stable across the sample.

  \`residual_sd\` is cross-sectional dispersion — how much there is to select from in a cohort. Treat it as a conditioning / allocation input, **not** an alpha source: it multiplies skill and cannot create it. Always read it alongside \`mean_pairwise_corr\`. Filter thin cohorts with \`min_names\`, and prefer \`n_effective\` (inverse-Herfindahl breadth) over \`n_names\` for anything breadth-related.
- **\`POST /api/cohorts/pnl-decomposition\`** with \`{positions: [{ticker, weight}], level, start_date, end_date}\` — splits a book's realized residual return into **selection** (what it earned holding names that beat their cohort average) and **drift** (what it earned purely from net exposure to that average). The two sum to the total exactly — an identity, not a fitted attribution — so it answers *"was I paid for stock-picking, or for being net long the average stock?"*. Weights are constant over the window and are **not** normalized; rescaling them changes the drift term. Unresolvable names come back in \`coverage.dropped\` — report those, never present the total as if the whole book were covered. **$0.05/call.**

**Routing rules:**
- "Show me the residual / decomposition for X" → \`get_returns_decomposition\` (or \`get_metrics\` if user just wants latest snapshot).
- "Which industries are dispersed / rotating in β?" → \`get_industry_panel\`.
- "What did the market / sectors do today / this month / YTD?" → \`get_etf_factor_returns\` (SPY + 11 GICS sectors). Pair with \`get_industry_panel\` when you want index-level moves plus stock-level industry β state.
- "Find me names where the residual is X / which stocks are in decile 1" → \`screen_rankings\`.
- "Where is there most opportunity to pick stocks / which sector is most dispersed?" → \`get_cohorts\` (\`residual_sd\` with \`mean_pairwise_corr\` and \`n_effective\`). Describe it as where selection opportunity sits, never as a prediction of returns.
- "Should I demean my residuals / is the residual mean zero?" → No. Fetch \`residual_mean\` from \`get_cohort_series\` at the matching level and subtract. This is the single most consequential thing to get right about ERM3 residuals.
- "Is my performance stock-picking or just being long the market / the average stock?" → \`decompose_selection_vs_drift\`. Report both components and the coverage gaps; describe it as realized attribution, never as a forecast or a verdict on skill going forward.
- "Give me the Lstar history for these 30 tickers" → \`batch_lstar\` (not 30 separate \`get_lstar\` calls).
- "What's AAPL's ROE / WACC / economic profit / cost of capital / payout / revenue?" → \`get_fundamentals\` (PIT quarterly; derived analytics + raw SEC-sourced line items in \`sec_facts\`; never forecasts or analyst fields).

## Fundamentals — PIT quarterly, derived analytics + SEC-sourced raw

- **\`GET /api/fundamentals/{ticker}?periods=N&as_of=YYYY-MM-DD\`** — point-in-time quarterly fundamentals for one ticker: TTM profitability (\`roe_ttm\`, \`roa_ttm\`, \`fcf_margin\`), capital-return ratios (\`payout_ratio\`, \`retention_ratio\`, \`buyback_ratio\`, \`total_payout_ratio\`, \`sustainable_growth\`), \`leverage_ratio\`, ERM3 cascade betas, the cost-of-capital layer (\`cost_of_equity\`, \`wacc\`, \`economic_profit\`, six-tenor \`rf_rate\`), and the equity-bridge residual + inputs mask. \`sec_facts\` carries **raw line items per cell where the serving value is SEC XBRL** (\`{concept: {value, source}}\`, source \`us_gaap|ifrs\`); vendor-sourced cells are not exposed as raw. ERP is caller-supplied via \`?erp=\`, tenor via \`?rf_tenor=\` (default 10y), or \`?grid=true\` for the erp×tenor sensitivity table. Rows are visible **iff \`filed_date <= as_of\`** — never "latest". **Realized historical only** — no forecasts, no analyst targets, no buy/sell signals. \`market_cap\` is a current snapshot, not per-quarter PIT; numeric line items are ~7 significant figures (not cent-level). Per-symbol, per-call (no batch variant). **$0.005/call.** Guide: https://riskmodels.app/docs/fundamentals

## Residual-return routing (\`lstar_rr\` vs \`l3_rr\`)

When the user asks for "the residual", "the idiosyncratic return", or "what's left after hedging",
prefer **\`lstar_rr\`** over **\`l3_rr\`**. \`lstar_rr\` is the residual at the cascade level the
model actually dispatched to (L1/L2/L3 picked at the canonical 1% marginal-ER threshold);
**\`l3_rr\`** is the fixed L3-subsector residual regardless of whether subsector hedging is
statistically warranted. For names where **\`lstar_level\`** is 1 or 2, \`l3_rr\` overstates
the cleanness of the residual because it subtracts a layer the model would not have prescribed.
Show \`lstar_level\` (1=L1 / 2=L2 / 3=L3 / null=no rec) alongside \`lstar_rr\` so the reader
sees which depth was assumed. For a custom threshold use \`GET /api/lstar?threshold=…\` instead.

## Agent prompts

After setup, the first message must name a live call. Do not answer from training data. Do not start with a capability catalog.

- MCP (connector already connected): ${FIRST_LIVE_PROMPT_MCP}
- REST (this chat, no MCP): ${FIRST_LIVE_PROMPT_REST}
- Do not paste **private** API keys into LLM chats; use env vars or local config. When this file
  includes a **Public sample API key** section, that token is intentionally published for agents.

Canonical site: https://riskmodels.app  |  Terms: https://riskmodels.net/terms/api
`;
}

function appendPublicSampleKey(baseUrl: string, plainKey: string): string {
  const trimmed = plainKey.trim();
  const mag7Csv = WALKTHROUGH_MAG7_TICKERS.join(", ");
  const mag7Shell = WALKTHROUGH_MAG7_TICKERS.join(" ");
  const pyMag7 = WALKTHROUGH_MAG7_TICKERS.map((t) => `"${t}"`).join(", ");

  return (
    `${buildLlmsTxtBase()}\n` +
    `## Public sample API key (LLM agents)\n\n` +
    `When this block appears, the host has enabled a **shared** demo credential (Doppler / Vercel: \`LLMS_TXT_PUBLIC_AGENT_KEY\`). ` +
    `It is intended for documentation and agent smoke tests on the **Magnificent 7** listed above (**${mag7Csv}**). ` +
    `It is rate-limited and may be rotated without notice; for production or the full ~3k universe, use a personal key from https://riskmodels.app/get-key .\n\n` +
    `Because this key is shared and published, it returns **derived analytics only** — risk decomposition, ` +
    `hedge ratios, factor exposures, volatility, and returns. Raw last-close and market-cap fields come back ` +
    `\`null\`; a personal key returns them.\n\n` +
    `Public MAG7 ticker array from the API (no auth; symbols may show GOOGL):\n\n` +
    `curl -sS "${baseUrl}/api/tickers?mag7=true"\n\n` +
    `RISKMODELS_API_KEY=${trimmed}\n\n` +
    `bash — latest L3 metrics for all seven (same symbols as the bullet list):\n\n` +
    `for t in ${mag7Shell}; do curl -sS -H "Authorization: Bearer $RISKMODELS_API_KEY" "${baseUrl}/api/metrics/$t"; done\n\n` +
    `bash — 5y returns + hedge-ratio / ER history (adjust \`years\`):\n\n` +
    `for t in ${mag7Shell}; do curl -sS -H "Authorization: Bearer $RISKMODELS_API_KEY" "${baseUrl}/api/ticker-returns?ticker=$t&years=5"; done\n\n` +
    `Python (riskmodels-py) after exporting \`RISKMODELS_API_KEY\`:\n\n` +
    `from riskmodels import RiskModelsClient, to_llm_context\n` +
    `client = RiskModelsClient.from_env()\n` +
    `for t in (${pyMag7}):\n` +
    `    print(to_llm_context(client.get_metrics(t)))\n`
  );
}

/**
 * @param appUrl - e.g. https://riskmodels.app (no trailing slash)
 */
export function buildLlmsTxt(appUrl: string): string {
  const base = appUrl.replace(/\/$/, "");
  const sampleKey = process.env.LLMS_TXT_PUBLIC_AGENT_KEY;
  if (sampleKey && sampleKey.length > 10) {
    return appendPublicSampleKey(base, sampleKey);
  }
  return buildLlmsTxtBase();
}
