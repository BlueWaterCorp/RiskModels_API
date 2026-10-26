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

RiskModels is a US equity risk API from Blue Water Macro Corp. Its ERM3 model splits each stock's risk into market, sector, subsector and stock-specific (residual) layers and gives an ETF hedge ratio for each market layer. It covers about 3,000 US stocks plus ETFs, end of day, with history from 2010–2011. The same data is available over REST, a Python SDK (riskmodels-py) and a hosted MCP server.

This file is reference documentation: endpoints, access, pricing, terms and field notes.

## Access options

| Use | How | Key |
|---|---|---|
| Try it without an account | Public sample key below (Magnificent 7 only, derived analytics only), or \`POST /api/auth/provision-free\` | Sample or free key |
| Full universe, personal | Free key at https://riskmodels.app/get-key (browser, no terminal) | Personal key |
| An AI assistant used by one person | Hosted MCP with OAuth sign-in (table below) | Sign-in per person |
| A platform serving its own users | REST from the platform's servers with one organization key, cached per security per trading day: https://riskmodels.app/docs/platform-integration | Organization key |

Discovery documents (this file, \`/openapi.json\`, \`/.well-known/mcp.json\`) need no key.

## Hosted MCP

Three Streamable HTTP routes serve the same 26 tools, prompts and billing. \`/api/mcp\` is the conventional client-neutral route; the named \`/api/mcp/openai\` and \`/api/mcp/sse\` routes remain supported. Sign-in is OAuth 2.0 + PKCE at riskmodels.app, or a Bearer key.

| Client | Endpoint | Setup |
|---|---|---|
| Claude Desktop, Claude web, Cursor (connector) | \`https://riskmodels.app/api/mcp/sse\` | Settings → Connectors → Add custom connector; OAuth client fields left blank |
| Grok (web, iOS, Android) | \`https://riskmodels.app/api/mcp/sse\` | grok.com/connectors → New Connector → Custom |
| ChatGPT (Plus and above, web, Developer Mode) | \`https://riskmodels.app/api/mcp/openai\` | Settings → Apps & Connectors → Advanced settings → Developer mode, then Create; OAuth |
| Gemini Spark custom apps | \`https://riskmodels.app/api/mcp\` | Connected Apps → Custom apps for Spark → Add a custom app; OAuth |
| Gemini CLI | \`https://riskmodels.app/api/mcp\` | \`gemini mcp add --transport http riskmodels https://riskmodels.app/api/mcp\`, or install https://github.com/BlueWaterCorp/riskmodels-gemini-extension |
| Cursor Agent Plugin | \`https://riskmodels.app/api/mcp/openai\` | Cursor plugin marketplace |
| Claude Code / Cowork plugin (skills, slash commands, analyst agent) | \`https://riskmodels.app/api/mcp/sse\` | \`claude plugin marketplace add BlueWaterCorp/riskmodels-plugin\` then \`claude plugin install riskmodels@riskmodels\` |
| Gemini Enterprise | \`https://riskmodels.app/api/mcp\` | Admin registers a Custom MCP data store (Streamable HTTP + OAuth) |

Gemini consumer web outside Spark custom apps has no generic custom MCP setting; it can use this file and the REST API directly. The ChatGPT MCP app is separate from ChatGPT's built-in Finances (Schwab) connector; holdings from Finances can be sent to \`POST /api/portfolio/risk-snapshot\` as weights.

A typical first check after connecting is \`riskmodels_compare\` on AAPL and NVDA followed by \`riskmodels_decompose\` on each; over REST, \`GET /api/metrics/AAPL\`. The answers carry residual explained risk and the L3 hedge ratios with their data date. Setup guide for every client: https://riskmodels.app/docs/agent-integration

## Security identity (free)

\`GET /api/identity/resolve\` (MCP: \`riskmodels_resolve_security_identity\`) says which security a ticker meant on a date and what a holding became through reviewed corporate actions: ticker reuse and changes, ADR conversions with ratios, splits, spin-offs and distributions, cash mergers and cancellations. Each answer has a status (resolved, ambiguous, unavailable, unsupported), a coverage label (reviewed, inferred, unknown) and the SEC filing for each applied event; an identifier it cannot place comes back unavailable or ambiguous rather than guessed. Example: \`/api/identity/resolve?identifier=FB&acquired_on=2015-06-01&as_of=2026-10-18\` returns 100 META; \`identifier=FB&as_of=2026-10-16\` returns the ETF that holds FB today.

## Magnificent 7 (MAG7)

These seven US equities are the usual demo and smoke-test set (landing charts, the public sample key, \`mag7=true\` on tickers):

${mag7BulletList()}

One-line form: **${mag7Csv}**. Examples use **GOOG** for Alphabet; **GOOGL** aliases to the same name in the API. \`GET /api/tickers?mag7=true\` may list **GOOGL**; both work with \`GET /api/metrics/{ticker}\` and related routes.

## Developer setup (terminal)

- Node.js LTS (https://nodejs.org) and an API key (https://riskmodels.app/get-key).
- \`RISKMODELS_API_KEY=… npx -y riskmodels@latest install\` (\`--dry-run\` first is optional). The installer stores the key in ~/.config/riskmodels/config.json and adds the RiskModels MCP server to supported clients (Cursor, Claude Desktop, Codex and others).
- Claude Code keeps its own MCP store. MCP only: \`claude mcp add --scope user --transport stdio riskmodels -- npx -y @riskmodels/mcp\`. With the plugin, its bundled connection is enough; a second registration of the same server is redundant. \`claude mcp list\` and \`claude plugin list\` show what is registered.
- Proxy form: \`npx -y mcp-remote https://riskmodels.app/api/mcp/sse\` with \`AUTHORIZATION=Bearer <key>\`.
- Python SDK (PyPI \`riskmodels-py\`): https://riskmodels.app/installation

## Reference links

- OpenAPI: https://riskmodels.app/openapi.json (or /api-reference in the portal)
- MCP discovery manifest: https://riskmodels.app/.well-known/mcp.json
- Pricing (per call; free discovery and identity routes): https://riskmodels.app/pricing
- Platform integration (server-side, caching, redistribution licence): https://riskmodels.app/docs/platform-integration
- Privacy: https://riskmodels.app/privacy (redirects to https://riskmodels.net/privacy)
- API terms (attribution "Powered by RiskModels"; no resale or redistribution as a feed without a written agreement): https://riskmodels.net/terms/api
- The hosted MCP endpoint authenticates every call, including initialize; data tools bill per underlying REST route.

## Panel / batch endpoints — when one call beats many

The decomposition routes that work across the universe (or many tickers) in a single call:

- **\`GET /api/returns-decomposition?ticker=…&years=…&include_lstar=true\`** — daily gross + L1/L2/L3 factor / combined-factor / residual return series for one ticker, all in one response. Replaces six \`?metrics=l1_cfr,l1_rr,...\` round-trips. Add \`include_lstar=true\` for the Lstar-dispatched residual + level. **$0.04/call + $0.01/extra year.**
- **\`GET /api/industry-panel?level=subsector&min_peers=20\`** — Vasicek peer-β cross-section by industry × cascade level: \`beta_mean\`, \`beta_variance\`, \`n_companies\`, \`total_log_mcap_weight\`. Default \`by=level\` is one row per (industry, level). \`by=fact\` is one row per (industry, fact). Multi-fact cells are historical (last L3 day 2021-06-22); latest teo is \`n_facts=1\`. One teo per call (latest by default). **$0.04/call.**
- **\`POST /api/rankings/screen\`** with \`{metric, cohort, window, min_percentile|decile|sector_filter, limit}\` — server-side rank filter over the full ds_rankings cross-section at one teo. Returns up to 500 rows sorted by \`rank_ordinal\` (1 = best). The stat-arb cross-section in one call — replaces N per-ticker \`/rankings\` calls. **$0.25/call.**
- **\`POST /api/batch/lstar\`** with \`{tickers: [...], years}\` — per-ticker daily Lstar history for up to 100 tickers in one call. Companion to \`lstar_rr\` in MetricsV3 (single-name latest); use this when you need history across a panel. **$0.015/ticker, min $0.03/call** (25% cheaper than repeated \`GET /lstar\`).
- **\`POST /api/signals/residual-reversion/basket\`** with \`{tickers: [...], weights?, signal_quality_min_quintile?}\` — aggregate the Phase D L3 residual mean-reversion signal across a user-supplied basket of up to 500 tickers. Returns weighted aggregate + decile / quality-quintile histograms + per-member rows. Equal-weight default; optional quality gate (Phase B: gross Sharpe lifts from ~0.79 to ~1.28 at quintile 5). Tickers not in \`ds_erm3_residual_signal\` are silently dropped and surfaced via \`coverage.missing_tickers\`. **$0.02/call.**
- **\`GET /api/universe/{name}/members\`** — active membership of a named universe (\`uni_mc_3000\` etc.) at one teo (latest by default). Active = monthly universe_mask AND daily validity gate. It aligns a screen, panel or book with the canonical universe without a local SDK cache. Response carries members + counts breakdown + a \`mask_as_of\` month-end stamp. **$0.02/call.**
- **\`GET /api/etf/factor-returns\`** — one-teo snapshot of close + trailing 1d / 21d / 63d / 252d total returns for **SPY + the 11 GICS sector SPDR ETFs** (XLE/XLB/XLI/XLY/XLP/XLV/XLF/XLK/XLC/XLU/XLRE). Public-scope only; tickers outside that set return 400. Pairs with \`industry-panel\` for the daily market + sector index read alongside aggregate stock-level industry βs. **$0.02/call.**
- **\`GET /api/data/etf/universe\`** — every ETF the API knows, with three capabilities, any combination per fund: \`cascade\` (SPY, the 11 sector and the subsector ETFs the ERM3 cascade hedges with), \`priced\` (daily returns, covariance and beta to SPY, from \`priced_from\`) and \`holdings\` (look-through holdings and benchmark fit), plus \`factor_role\` and FIGI / CIK / BW identifiers. Filter with \`?cascade=\`, \`?priced=\`, \`?holdings=\` (true/false) and \`?factor_role=\`. On the 2026-10-14 build: 220 funds, 56 cascade, 128 priced, 148 with holdings; 10 style and 31 macro roles. \`GET /api/data/etf/{ticker}\` returns the same block for one fund (200 for every known fund) and \`/api/data/etf/search\` carries it on each hit. Reason codes: \`etf_outside_priced_universe\` (known fund, no daily returns), \`etf_no_return_history_in_window\` (priced, but no rows in the window), \`symbol_not_found\` (on no list). \`/api/ticker-returns\` does not bill a response with no rows and names the reason in \`_metadata.data_warning_code\`. **Free** (data-gateway per-IP rate limit). Guide: https://github.com/BlueWaterCorp/RiskModels_API/blob/main/docs/ETF_COVERAGE.md
- **\`GET /api/cohorts\`** and **\`GET /api/cohorts/series\`** — cross-sectional residual statistics by cohort (SPY + the 11 GICS sector SPDRs) from \`ds_erm3_cohorts\`: \`residual_mean\`, \`residual_sd\`, \`residual_skew\`, \`residual_p10/p90\`, \`mean_pairwise_corr\`, \`n_names\`, \`n_effective\`, \`weight_top1\`, \`membership_churn\`, \`linked_beta\` (+link_fit_resid_sd/r2/roll63), \`cohort_factor_return\`, \`cohort_residual_return\`, \`cohort_ER\`, \`factor_source\`. \`link_fit_resid_sd\` is the classical OLS standard error of \`linked_beta\`: the slope SE of the 252-day link regression (\`min_periods\` 126) on the window's common sample of dates, with n − 2 degrees of freedom. It is homoskedastic and conditional on the realized parent series, so it leaves out parent-construction and beta-drift uncertainty. Cross-section **$0.04/call**, series **$0.15/call**; \`GET /api/cohorts/roster\` is free discovery.

  **Residuals are not zero-mean.** ERM3 regressions are fitted *without an intercept*, deliberately, so each stock's residual retains its alpha — the cross-sectional mean is **not zero**. A relative-ranking signal needs \`residual_mean\` subtracted at the level the residual is defined against (sector residuals demean within sector cohorts). A drift figure is meaningful only with its window; the sign is not stable across the sample.

  \`residual_sd\` is cross-sectional dispersion — how much there is to select from in a cohort. It is a conditioning / allocation input, **not** an alpha source: it multiplies skill and cannot create it. It reads best alongside \`mean_pairwise_corr\`; \`min_names\` filters thin cohorts, and \`n_effective\` (inverse-Herfindahl breadth) is the better breadth measure than \`n_names\`.
- **\`POST /api/cohorts/pnl-decomposition\`** with \`{positions: [{ticker, weight}], level, start_date, end_date}\` — splits a book's realized residual return into **selection** (what it earned holding names that beat their cohort average) and **drift** (what it earned purely from net exposure to that average). The two sum to the total exactly — an identity, not a fitted attribution — so it answers *"was I paid for stock-picking, or for being net long the average stock?"*. Weights are constant over the window and are **not** normalized; rescaling them changes the drift term. Unresolvable names come back in \`coverage.dropped\`; the total covers only the resolved names. **$0.25/call.**
- **\`POST /api/portfolio/exposure\`** with \`{positions: [{ticker, value}], hedge_level?, as_of?, top_contributors?, include_positions?}\` — signed long/short book as dollar market values (short < 0, up to 1000 positions, ETFs allowed), **never normalised**. Returns L1 beta-dollars by sector, ETF hedge trades at L*/L1/L2/L3 (\`hr\` = ETF dollars per $1 long stock; \`total_neutralizing_trade_usd\` = stock hedge − ETFs already held), a systematic (xᵀΣx) and diagonal residual risk split, the market beta on that risk basis (\`beta.risk_basis\`, xᵀΣe_SPY/σ²_SPY; the L1 \`total_beta_usd\` is kept), \`scenario_inputs\` (each ETF's \`beta_to_spy\`; per-name level, L1 beta, hedge ratios and residual vol with \`include_positions: true\`), \`coverage\` (a known ETF it cannot price is \`etf_outside_priced_universe\` or \`etf_no_return_history_in_window\` with \`see\`, not \`symbol_not_found\`) and \`warnings\`. \`as_of\` reaches back to 2011-12-07. It is the route for any book with a short (or more than 100 names); \`/portfolio/risk-index\` takes positive weights only. \`warnings\` (e.g. \`hedge_added_variance\`, \`share_class_netted\`, \`not_at_snapshot_teo\`) and \`coverage.dropped\` qualify the result; totals cover only the modelled names. **$0.25/call up to 25 names modelled, $1.00 above.** History without sending holdings: \`POST /api/portfolio/exposure/history\` (month-end, $1.25 / $5.00) and \`/history/daily\` ($2.50 / $10.00) take tickers only; the Python SDK joins locally. Their history starts 2010-12-08 for hedge ratios, 2011-12-07 for explained-risk/residual shares and \`stock_var\`, 2013-01-01 for \`lstar_level\` (nothing earlier is served; see \`history_available_from\` and \`warnings\`). Guide: https://riskmodels.app/docs/long-short-exposure

**Which endpoint answers which question:**
- "Show me the residual / decomposition for X" → \`GET /api/returns-decomposition\` (latest snapshot only: \`GET /api/metrics/{ticker}\`).
- "Which industries are dispersed / rotating in β?" → \`GET /api/industry-panel\`.
- "What did the market / sectors do today / this month / YTD?" → \`GET /api/etf/factor-returns\` (SPY + 11 GICS sectors), alongside \`GET /api/industry-panel\` for stock-level industry β state.
- "Find me names where the residual is X / which stocks are in decile 1" → \`POST /api/rankings/screen\`.
- "Where is there most opportunity to pick stocks / which sector is most dispersed?" → \`GET /api/cohorts\` (\`residual_sd\` with \`mean_pairwise_corr\` and \`n_effective\`). It measures where selection opportunity sits; it is not a return forecast.
- "Should I demean my residuals / is the residual mean zero?" → No. \`residual_mean\` from \`GET /api/cohorts/series\` at the matching level is the value to subtract. This is the most consequential detail of ERM3 residuals.
- "Is my performance stock-picking or just being long the market / the average stock?" → \`POST /api/cohorts/pnl-decomposition\`. Both components and the coverage gaps belong in the answer; it is realized attribution, not a forecast or a verdict on skill.
- "What is the beta / hedge / risk of my long/short book?" (any short position) → \`POST /api/portfolio/exposure\` with signed dollar values; \`warnings\` and \`coverage.dropped\` qualify the numbers.
- "Can I get returns / beta / holdings for this ETF?" or an ETF came back empty → \`GET /api/data/etf/{ticker}\` (or \`/api/data/etf/universe\`) and read \`capabilities\` before calling a priced route.
- "Give me the Lstar history for these 30 tickers" → \`POST /api/batch/lstar\` (one call instead of 30 \`GET /api/lstar\` calls).
- "What's AAPL's ROE / WACC / economic profit / cost of capital / payout / revenue?" → \`GET /api/fundamentals/{ticker}\` (PIT quarterly; derived analytics + raw SEC-sourced line items in \`sec_facts\`; no forecasts or analyst fields).

## Fundamentals — PIT quarterly, derived analytics + SEC-sourced raw

- **\`GET /api/fundamentals/{ticker}?periods=N&as_of=YYYY-MM-DD\`** — point-in-time quarterly fundamentals for one ticker: TTM profitability and capital-return ratios, \`leverage_ratio\`, long-window ERM3 valuation betas, strict reported-data \`cost_of_debt\` / \`wacc\`, parallel \`cost_of_debt_imputed\` / \`wacc_imputed\` when the PIT-lagged high-quality-market proxy is available, equity-charge \`economic_profit\`, six-tenor \`rf_rate\`, and the equity-bridge residual + inputs mask. The proxy uses the period-end 10-year Treasury plus a monthly \`HQMCB10YR - GS10\` spread and is not issuer-specific; provenance and the lagged reference month are returned. \`sec_facts\` carries **raw line items per cell where the serving value is SEC XBRL**; vendor-sourced cells are not exposed as raw. \`erp\` is a request parameter (default 0.05 when omitted), tenor is selected with \`?rf_tenor=\` (default 10y), and \`?grid=true\` returns the latest-period ERP×tenor sensitivity table with strict and imputed WACC fields. Rows are visible **iff \`filed_date <= as_of\`** — never "latest". **Realized historical only** — no forecasts, analyst targets, or buy/sell signals. \`market_cap\` is a current snapshot, not per-quarter PIT. Per-symbol, per-call (no batch variant). **$0.02/call.** Guide: https://riskmodels.app/docs/fundamentals

## Residual-return fields (\`lstar_rr\` vs \`l3_rr\`)

For "the residual", "the idiosyncratic return", or "what's left after hedging",
**\`lstar_rr\`** is usually the better field than **\`l3_rr\`**. \`lstar_rr\` is the residual at the cascade level the
model actually dispatched to (L1/L2/L3 picked at the canonical 1% marginal-ER threshold);
**\`l3_rr\`** is the fixed L3-subsector residual regardless of whether subsector hedging is
statistically warranted. For names where **\`lstar_level\`** is 1 or 2, \`l3_rr\` overstates
the cleanness of the residual because it subtracts a layer the model would not have prescribed.
\`lstar_level\` (1=L1 / 2=L2 / 3=L3 / null=no rec) shows which depth \`lstar_rr\` assumed. For a custom threshold use \`GET /api/lstar?threshold=…\` instead.

## Keys in chats

Private API keys belong in environment variables or local config, not in chat messages. The **Public sample API key** section, when present, is a key published on purpose for documentation and agent smoke tests.

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
