/**
 * Source body for https://riskmodels.app/llms.txt (served by app/llms.txt/route.ts).
 * Optional `LLMS_TXT_PUBLIC_AGENT_KEY` appends a shared sample Bearer token for LLM crawlers.
 */

import { WALKTHROUGH_MAG7_TICKERS } from "@/lib/landing/walkthrough-chart-data";

function mag7BulletList(): string {
  return WALKTHROUGH_MAG7_TICKERS.map((t) => `- ${t}`).join("\n");
}

function buildLlmsTxtBase(): string {
  const mag7Csv = WALKTHROUGH_MAG7_TICKERS.join(", ");
  return `# RiskModels (riskmodels.app)

RiskModels is an agent-friendly US equity risk API: hierarchical (L3) variance decomposition,
ETF hedge ratios, metrics, portfolio snapshots, and a hosted MCP surface.

**No sign-in yet?** If this host publishes a shared demo key, you will find it under **Public sample API key** below — use it as \`RISKMODELS_API_KEY\` / \`Authorization: Bearer …\` for MAG7 examples. That path is meant for browser agents that cannot run \`POST /api/auth/provision-free\`.

## Magnificent 7 (MAG7)

These seven US equities are the usual demo / smoke-test set (landing charts, optional public sample key, \`mag7=true\` on tickers):

${mag7BulletList()}

One-line form: **${mag7Csv}**. For Alphabet use **GOOG** in examples; **GOOGL** aliases to the same name in the API. The public JSON from \`GET /api/tickers?mag7=true\` may list **GOOGL**; both work with \`GET /api/metrics/{ticker}\` and related routes.

## First-time setup (human runs once in a terminal)

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

- Hosted MCP (Streamable HTTP): https://riskmodels.app/api/mcp/sse — use with an MCP client and
  Bearer token; discovery tools need no key; data tools bill per underlying REST route.
- OpenAPI: https://riskmodels.app/openapi (or /api-docs in the portal)
- Python SDK (PyPI): riskmodels-py — see https://riskmodels.app/docs/python-sdk

## Panel / batch endpoints — when one call beats many

The decomposition routes that work across the universe (or many tickers) in a single call:

- **\`GET /api/returns-decomposition?ticker=…&years=…&include_lstar=true\`** — daily gross + L1/L2/L3 factor / combined-factor / residual return series for one ticker, all in one response. Replaces six \`?metrics=l1_cfr,l1_rr,...\` round-trips. Add \`include_lstar=true\` for the Lstar-dispatched residual + level. **$0.02/call.**
- **\`GET /api/industry-panel?level=subsector&min_peers=20\`** — Vasicek peer-β cross-section by EODHD industry × cascade level: \`beta_mean\`, \`beta_variance\`, \`n_companies\`, \`total_log_mcap_weight\`. The macro / sector-rotation surface. One teo per call (latest by default). **$0.02/call.**
- **\`POST /api/rankings/screen\`** with \`{metric, cohort, window, min_percentile|decile|sector_filter, limit}\` — server-side rank filter over the full ds_rankings cross-section at one teo. Returns up to 500 rows sorted by \`rank_ordinal\` (1 = best). The stat-arb cross-section in one call — replaces N per-ticker \`/rankings\` calls. **$0.02/call.**
- **\`POST /api/batch/lstar\`** with \`{tickers: [...], years}\` — per-ticker daily Lstar history for up to 100 tickers in one call. Companion to \`lstar_rr\` in MetricsV3 (single-name latest); use this when you need history across a panel. **$0.005/ticker, min $0.01/call** (25% cheaper than repeated \`GET /lstar\`).

**Routing rules:**
- "Show me the residual / decomposition for X" → \`get_returns_decomposition\` (or \`get_metrics\` if user just wants latest snapshot).
- "Which industries are dispersed / rotating in β?" → \`get_industry_panel\`.
- "Find me names where the residual is X / which stocks are in decile 1" → \`screen_rankings\`.
- "Give me the Lstar history for these 30 tickers" → \`batch_lstar\` (not 30 separate \`get_lstar\` calls).

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

- Compare tickers: "Compare AAPL and NVDA using RiskModels. What am I really betting on?"
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
