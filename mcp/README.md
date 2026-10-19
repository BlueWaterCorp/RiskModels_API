# RiskModels API MCP Server

NPM package: `@riskmodels/mcp`

Release note: publish **`@riskmodels/sdk`** to npm first, then **`@riskmodels/mcp`**. In this monorepo, `mcp/package.json` uses `"@riskmodels/sdk": "file:../packages/riskmodels-sdk"` so `cd mcp && npm ci && npm run build` works without publishing; **before `npm publish` of `@riskmodels/mcp`**, replace that dependency with a semver range (e.g. `^0.1.1`) after `@riskmodels/sdk` is live on the registry.

**Decompose** a US stock into market, sector, subsector, and residual risk &mdash; with SPY / sector / subsector **ETF hedge ratios**. One call, daily hedge-ratio history from 2010-12-08.

MCP server that exposes the **RiskModels API** inside [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com), [Zed](https://zed.dev), ChatGPT and any other [MCP](https://modelcontextprotocol.io) client.

## Tool set 2.0

Version 2.0.0 ships one tool registry (`registerRiskModelsTools` in `lib/mcp/tools/riskmodels-tools.ts`) shared by all three MCP surfaces:

| Surface | Tools |
|---|---|
| npm stdio (`npx -y @riskmodels/mcp`) | 25 (published 2.0.0: 24, before `riskmodels_resolve_security_identity`) |
| Hosted `https://riskmodels.app/api/mcp/sse` (Claude) | 26 (the 25 + `riskmodels_render_artifact`) |
| Hosted `https://riskmodels.app/api/mcp/openai` (ChatGPT, Cursor plugin, Gemini) | 26 (same as `/sse`) |

Every tool is read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`). Each description says when to use the tool, which tool to use instead, what it returns, data freshness (end-of-day) and its price. All tools call existing REST routes and bill at the REST price; the MCP layer adds no charge.

| Tool | REST route(s) | Price |
|---|---|---|
| `riskmodels_get_stock_snapshot` | `GET /metrics/{ticker}` | $0.005 |
| `riskmodels_decompose` | `POST /decompose` (optional `dollars` adds ETF hedge notionals) | $0.005 |
| `riskmodels_compare` | `POST /batch/analyze` (2-100 tickers) | $0.015/ticker, min $0.03 |
| `riskmodels_get_returns` | `GET /ticker-returns` (daily returns with daily L3 hedge ratios and explained risk) | $0.02 + $0.01/extra year |
| `riskmodels_get_return_attribution` | `GET /returns-decomposition` | $0.04 + $0.01/extra year |
| `riskmodels_get_residual_returns` | `GET /lstar` (1 ticker) or `POST /batch/lstar` (2-100) | 1 ticker: $0.02 + $0.01/extra year; 2-100: $0.015/ticker + $0.0075/ticker/extra year, min $0.03 |
| `riskmodels_get_residual_signal` | `POST /signals/residual-reversion/basket` | $0.02 |
| `riskmodels_get_macro_correlation` | `POST /correlation` | $0.01 |
| `riskmodels_get_fundamentals` | `GET /fundamentals/{ticker}` | $0.02 |
| `riskmodels_analyze_portfolio` | `POST /batch/analyze` (ETF hedge notionals at `level` only when every position is in dollars) | $0.015/position, min $0.03 |
| `riskmodels_get_portfolio_risk_snapshot` | `POST /snapshot` (variance decomposition, diversification, return attribution, drawdown) | $1.25 |
| `riskmodels_portfolio_exposure` | `POST /portfolio/exposure` (long/short, up to 1000 names) | $0.25 up to 25 names, $1.00 above |
| `riskmodels_decompose_selection_vs_drift` | `POST /cohorts/pnl-decomposition` | $0.25 |
| `riskmodels_get_my_positions` | riskmodels.net `GET /api/positions` (linked brokerage book) | Free |
| `riskmodels_get_rankings` | `GET /rankings/{ticker}` | $0.005 |
| `riskmodels_screen_rankings` | `POST /rankings/screen` | $0.25 |
| `riskmodels_get_cohorts` | `GET /cohorts` or `GET /cohorts/series` | $0.04 / $0.15 |
| `riskmodels_get_peers` | `GET /peers` | $0.005 |
| `riskmodels_search` | `GET /tickers`, `/data/etf/search`, `/funds/search`, `/13f/filers/search` by `type` | Free |
| `riskmodels_resolve_security_identity` | `GET /identity/resolve` (point-in-time identity and corporate-action carry, SEC-cited, coverage-labelled) | Free |
| `riskmodels_get_filer` | `GET /13f/filers/{id}/snapshot` (+ `/holdings` when `holdings_top` is set; + one GET per `include` value, see below) | $0.05 snapshot (+$0.02 holdings, +$0.02 per include) |
| `riskmodels_get_fund` | `GET /funds/snapshot/{id}` (+ `/funds/{id}/holdings` when `holdings_limit` is set; + one GET per `include` value, see below) | $0.05 snapshot (+$0.02 holdings, +$0.02 per include) |
| `riskmodels_get_etf` | `GET /data/etf/{ticker}` (+ `/holdings` when `holdings_top` is set; `snapshot: false` for holdings only) | Free |
| `riskmodels_get_benchmark_fit` | `GET /data/benchmark-fit` | $0.02 |
| `riskmodels_get_factor_returns` | `GET /macro-factors` (`kind=macro`) or `GET /etf/factor-returns` (`kind=sector_etf`) | $0.005 macro / $0.02 sector ETF |
| `riskmodels_render_artifact` (hosted only) | render service | $0.25 list price |

### Include values

New data arrives as include values, not new tools. An entity tool takes an optional `include` array; each value triggers one extra GET to an existing REST route, billed at that route's price.

| Tool | `include` value | REST route | Price |
|---|---|---|---|
| `riskmodels_get_fund` | `hedge` | `GET /funds/{id}/hedge` (latest L1/L2/L3 ETF hedge ratios from the holdings look-through) | $0.02 |
| `riskmodels_get_fund` | `nav_history` | `GET /funds/{id}/nav?start_date=…` | $0.02 |
| `riskmodels_get_fund` | `portfolio_history` | `GET /funds/{id}/portfolio?start_date=…` | $0.02 |
| `riskmodels_get_fund` | `metrics` | `GET /funds/{id}` | $0.02 |
| `riskmodels_get_filer` | `concentration` | `GET /13f/filers/{id}/concentration?start_date=…` | $0.02 |
| `riskmodels_get_filer` | `portfolio_history` | `GET /13f/filers/{id}/portfolio?start_date=…` | $0.02 |
| `riskmodels_get_filer` | `metrics` | `GET /13f/filers/{id}` | $0.02 |

- History and concentration values cover the last `history_months` months (default 24, max 60); the MCP layer does not request an unbounded panel.
- Holdings stay on `holdings_limit` (fund) and `holdings_top` (filer, ETF). `snapshot: false` skips the snapshot call so a caller pays only for holdings or include values; with `snapshot: false` and neither holdings nor an include value the tool returns an error.
- Response: `{ snapshot?, holdings?, includes: { <value>: data | { ok: false, status, error } }, billing: { base_usd, includes_usd, total_usd } }`. Each include block is the route's own response, with its own date fields (`teo`, `end_teo` or `report_date`). `billing` sums the list prices of calls that succeeded; failed REST calls are not charged.
- A failed snapshot or holdings call is a tool error and no include fires. Includes run in parallel; a failed include is reported in its block and does not flag the result as an error.

### Security identity examples

`riskmodels_resolve_security_identity` (REST `GET /api/identity/resolve`, free) answers two questions without guessing. Results are from riskmodels.app on 2026-10-19.

**Point-in-time lookup: which security a ticker meant on a date.**

| Request | Answer | Coverage |
|---|---|---|
| `identifier=FB&as_of=2026-10-16` | ProShares ETF `BW-BBG01VRMNFB1`. Meta's use of FB ended 2022-06-09. | inferred |
| `identifier=BBBY&as_of=2026-01-05` | The Overstock line, renamed Bed Bath & Beyond, Inc., which took BBBY on 2025-08-29 | reviewed |
| `identifier=ZZZZ&as_of=2015-01-02` | `unavailable`, not guessed | unknown |

**Portfolio-history lookup: what a holding became.**

| Request | Answer | Coverage |
|---|---|---|
| `identifier=FB&acquired_on=2015-06-01&as_of=2026-10-18` | 100 META | reviewed |
| `identifier=T&acquired_on=2021-01-04&as_of=2026-10-18` | 100 T + 24 WBD + cash in lieu of 0.1917 WBD (2022-04-08 distribution) | reviewed |
| `identifier=GE&acquired_on=2020-01-02&quantity=800` | 100 GE (2021 one-for-eight reverse split) + 33 GEHC + 25 GEV + cash in lieu | reviewed |
| `identifier=TWTR&acquired_on=2020-01-02` | $5,420 cash, `no_equity_successor: true` | reviewed |
| `identifier=BBBY&acquired_on=2020-01-02` | Cancelled 2023-09-29 with no consideration, `no_equity_successor: true`; never the brand buyer | reviewed |

Every applied event in the response carries its SEC filing link. A purchase between a record date and the distribution, with no seeded ex-date, returns `unsupported` rather than an assumed entitlement.

### Migration from 1.x

Tool names removed in 2.0.0 and their replacements. Unless noted, merged tools call the same REST routes with the same request bodies as the tools they replace.

| 1.x tool | 2.0 tool | Notes |
|---|---|---|
| `get_metrics` | `riskmodels_get_stock_snapshot` | Same `GET /metrics/{ticker}`; returns the raw payload with `api_call` metadata instead of the `_cost_usd`-style meter fields |
| `riskmodels_get_hedge_levels` | `riskmodels_get_stock_snapshot` | `hedge_levels` is a block of the same response |
| `riskmodels_hedge_position` | `riskmodels_decompose` with `dollars` | Same `POST /decompose` |
| `get_l3_decomposition` | `riskmodels_get_returns` or `riskmodels_get_return_attribution` | Removed. `GET /ticker-returns` carries the daily L3 hedge ratios and explained risk; `GET /returns-decomposition` splits each day's return into factor and residual parts. The REST route `GET /l3-decomposition` is unchanged |
| `riskmodels_get_lstar` | `riskmodels_get_residual_returns` with one ticker | Same `GET /lstar`; input is `tickers: ["NVDA"]`; `axis` dropped (industry is the only value) |
| `riskmodels_batch_lstar`, `riskmodels_get_residual_returns_batch` (OpenAI) | `riskmodels_get_residual_returns` with 2-100 tickers | Same `POST /batch/lstar`; `format` dropped (JSON only through MCP; CSV/Parquet stay on the REST route) |
| `get_fundamentals` (npm only) | `riskmodels_get_fundamentals` | Same route and params |
| `riskmodels_hedge_portfolio` | `riskmodels_analyze_portfolio` with dollar positions | Same `POST /batch/analyze`; `level` selects the hedge depth |
| `post_snapshot` (npm only) | `riskmodels_get_portfolio_risk_snapshot` | Same `POST /snapshot` body (`portfolio` → `positions`, `lookback_days`, `benchmark`) |
| `riskmodels_portfolio_decompose`, `get_portfolio_risk_snapshot` | `riskmodels_get_portfolio_risk_snapshot` | Now `POST /snapshot`, the canonical superset of `POST /portfolio/risk-snapshot` (same $1.25; includes the diversification analytics, with the window set by `lookback_days`). `title`, `as_of_date` and `window_days` are not offered |
| `riskmodels_search_tickers` | `riskmodels_search` (`type: "stock"`) | `search` is now `q` |
| `riskmodels_search_etfs` | `riskmodels_search` (`type: "etf"`) | |
| `riskmodels_search_filers` | `riskmodels_search` (`type: "filer"`) | |
| `riskmodels_search_funds` (OpenAI) | `riskmodels_search` (`type: "fund"`) | Now on every surface |
| `riskmodels_get_filer_snapshot` | `riskmodels_get_filer` | Response is `{ snapshot }` |
| `riskmodels_get_filer_holdings` | `riskmodels_get_filer` with `holdings_top` | Response is `{ snapshot, holdings }`; also charges the $0.05 snapshot |
| `riskmodels_get_fund_snapshot` (OpenAI) | `riskmodels_get_fund` | Now on every surface |
| `riskmodels_get_fund_holdings` (OpenAI) | `riskmodels_get_fund` with `holdings_limit` | Also charges the $0.05 snapshot |
| `riskmodels_get_etf_holdings` | `riskmodels_get_etf` with `holdings_top` | Response is `{ snapshot, holdings }` |
| `riskmodels_get_macro_factor_returns` (OpenAI) | `riskmodels_get_factor_returns` (`kind: "macro"`) | Now on every surface |
| `riskmodels_get_sector_etf_returns` (OpenAI) | `riskmodels_get_factor_returns` (`kind: "sector_etf"`) | Now on every surface |
| `riskmodels_get_peers` (OpenAI) | `riskmodels_get_peers` | Now on every surface |
| `riskmodels_call_endpoint` | removed | The fund, peer and factor routes it reached now have explicit tools |
| `riskmodels_list_endpoints`, `riskmodels_get_capability`, `riskmodels_get_schema`, `riskmodels_get_openapi_spec` | removed | Use the resources `riskmodels:///capabilities`, `riskmodels:///schemas/list`, `riskmodels:///schemas/{path}`, `riskmodels:///openapi` |
| `riskmodels_whitepaper_example` | removed | The `follow_whitepaper` prompt and white-paper resources remain and run the regular tools |

The server sends MCP `instructions` on initialize (one text for every surface). Prompt `first_live_call` is the AAPL vs NVDA first message.

---

## Resources (read-only, no auth)

| URI | Description |
|-----|-------------|
| `riskmodels:///manifest` | Agent Protocol manifest. Fetches from `RISKMODELS_API_BASE` when set; otherwise returns static capabilities. |
| `riskmodels:///capabilities` | Full list of API capabilities (endpoints, parameters, pricing, examples). |
| `riskmodels:///schemas/list` | List of available response schema paths. |
| `riskmodels:///schemas/{path}` | JSON schema for a response (e.g. `ticker-returns-v2.json`). |
| `riskmodels:///openapi` | OpenAPI 3.x spec (`data/openapi.json`). |
| `riskmodels://whitepaper/one-position-four-bets` | Live-paper overview for the Medium article. |
| `riskmodels://whitepaper/chapter/01-core-claim` | Short markdown chapter: one position is four bets. |
| `riskmodels://whitepaper/chapter/02-aapl-vs-nvda` | Short markdown chapter for the AAPL vs NVDA comparison. |
| `riskmodels://whitepaper/chapter/03-hedging` | Short markdown chapter for hedge-ratio scaling. |
| `riskmodels://examples/aapl-nvda-crwd` | Short markdown example for a three-name comparison. |

## Prompts

| Prompt | Description |
|--------|-------------|
| `first_live_call` | Compares AAPL and NVDA with `riskmodels_compare`, then `riskmodels_decompose` on each. |
| `follow_whitepaper` | Reads the white-paper resources, then runs the four live examples with `riskmodels_compare`, `riskmodels_decompose` and `riskmodels_get_portfolio_risk_snapshot`. |
| `reproduce_aapl_nvda` | Same as `first_live_call`. |
| `hedge_single_position` | `riskmodels_decompose` with a ticker and dollar position. |
| `explain_my_portfolio` | Reads the linked book with `riskmodels_get_my_positions`, then `riskmodels_analyze_portfolio` or `riskmodels_portfolio_exposure`. |

The hosted `riskmodels_render_artifact` returns an MCP `image` content block for `format: "png"` (`data` holds the base64 PNG; `mimeType` is `image/png`) with provenance text (`resolved_as_of`, `receipt_id`). JSON, SVG and Plotly figure formats are unchanged. It is not part of the stdio package.

Every data-tool response carries `api_call` metadata (method, path, redacted curl, `data_as_of`, `request_id`, `cost_usd` when the API returns it).

### Credentials

The server resolves the API key in this order:

1. `RISKMODELS_API_KEY` from the MCP client's env config (explicit override).
2. `apiKey` field in `~/.config/riskmodels/config.json` (shared with the `riskmodels` CLI).

Run `riskmodels config init` once — the CLI's stored key is automatically picked up by the MCP server. No need to duplicate the key in your `claude_desktop_config.json`.

Base URL resolution: `RISKMODELS_API_BASE` env → `apiBaseUrl` in CLI config → `https://riskmodels.app` default.

**Hosted transport (`POST https://riskmodels.app/api/mcp/sse`):** send header `Accept: application/json, text/event-stream`. Without it, some clients receive **406 Not Acceptable**.

---

## Python SDK on PyPI

For Python workflows outside MCP, call the REST API directly or install **`riskmodels-py`** from [PyPI](https://pypi.org/project/riskmodels-py/) ([`sdk/README.md`](../sdk/README.md)).

---

## Setup

```bash
cd mcp
npm install
npm run build
```

This repo includes **`.cursor/mcp.json`** pointing at `node` + `mcp/dist/index.js` (relative to the **RiskModels_API** workspace root). After `cd mcp && npm ci && npm run build`, open **RiskModels_API** as a folder in Cursor (or add it in a multi-root workspace), then **restart Cursor** or reload MCP so **`riskmodels_compare`** appears.

### Claude Desktop / `npx` (common mistakes)

- **There is no `mcp` subcommand on the npm package.** The CLI binary is **`riskmodels`**. Do **not** run `npx -y riskmodels-cli mcp` — that legacy package does not provide the new installer flow.
- **Preferred (deterministic):** pin the CLI package so `npx` does not resolve a stale cache — e.g. `RISKMODELS_API_KEY=... npx -y riskmodels@latest install` (writes MCP configs via `riskmodels install`). Same flow as [Quickstart](https://riskmodels.app/quickstart).
- **Use one of these:**
  - **`npx -y @riskmodels/mcp`** — stdio MCP package merged into configs by `npx -y riskmodels@latest install` / global `riskmodels install`.
  - **`riskmodels mcp-config`** — prints a ready-to-paste `mcpServers` block for Claude Desktop (`--client claude-desktop`) or Cursor. Use **`riskmodels mcp-config --embed-key`** only if you want the key in the JSON env block.
  - **`riskmodels mcp`** — runs the stdio MCP server (same as `node mcp/dist/index.js`). Requires `mcp/dist/index.js` to exist (build `mcp/` first), or set **`RISKMODELS_MCP_SERVER_PATH`** to that file.
  - **`node /absolute/path/to/RiskModels_API/mcp/dist/index.js`** — always works if the build exists.

### Claude Code (`claude` CLI)

The **`riskmodels install`** command merges MCP into **Claude Desktop** (`claude_desktop_config.json`) and **Cursor** — not into **Claude Code** (the `claude` terminal application), which maintains its own MCP configuration.

After you have run `riskmodels install` and have a key in `~/.config/riskmodels/config.json`, register the stdio server for Claude Code:

```bash
claude mcp add --scope user --transport stdio riskmodels -- npx -y @riskmodels/mcp
```

Restart **`claude`**, then run **`claude mcp list`** — `riskmodels` should show as connected. If it does not, use the **hosted** `mcp-remote` transport with `AUTHORIZATION=Bearer <key>` (same JSON pattern as in the “Hosted endpoint” section below).

### ChatGPT (Developer Mode)

ChatGPT supports custom remote MCP servers on **Plus / Pro / Business / Enterprise / Edu** (web). The UI is hidden until Developer mode is enabled:

1. **Settings → Apps & Connectors → Advanced settings** → turn on **Developer mode**.
2. **Apps & Connectors → Create**.
3. **Connector URL:** `https://riskmodels.app/api/mcp/sse`
4. Choose **OAuth** and complete sign-in at riskmodels.app when prompted.

**Not the Finances connector.** ChatGPT’s Schwab / Finances integration only exposes brokerage holdings. RiskModels is a separate MCP app for factor decomposition and hedge ratios. To analyze a Schwab book without MCP, keep Finances for positions and paste tickers into a chat with `https://riskmodels.app/llms.txt` (REST for one session).

Discovery manifest: `https://riskmodels.app/.well-known/mcp.json` · full guide: [Agent integration](https://riskmodels.app/docs/agent-integration#chatgpt-mcp).

### Grok (Connectors)

Grok supports custom MCP without a Developer Mode toggle:

1. Open [grok.com/connectors](https://grok.com/connectors).
2. **New Connector → Custom**.
3. **MCP server URL:** `https://riskmodels.app/api/mcp/sse`
4. Complete OAuth sign-in at riskmodels.app.

Guide: [Agent integration — Grok](https://riskmodels.app/docs/agent-integration#grok-mcp) · xAI: [Connectors](https://docs.x.ai/grok/connectors).

### Gemini

- **Consumer web (`gemini.google.com`):** no custom MCP connector UI — use `https://riskmodels.app/llms.txt` in chat or REST with a key.
- **Gemini CLI / Antigravity:** `gemini mcp add --transport http riskmodels https://riskmodels.app/api/mcp/sse`, then `/mcp auth riskmodels`.
- **Gemini Enterprise:** admin registers a Custom MCP Server data store in Google Cloud (Streamable HTTP + OAuth). See [Agent integration — Gemini](https://riskmodels.app/docs/agent-integration#gemini).

`@riskmodels/sdk` powers in-tool SDK calls inside `@riskmodels/mcp`; published builds use Node ESM with `.js` import specifiers so `npx -y @riskmodels/mcp` loads under Node 18+.

### Hosted endpoint (`https://riskmodels.app/api/mcp/sse`)

The hosted endpoint implements the **MCP Streamable HTTP** transport (current SDK spec, successor to legacy SSE+companion-POST). Stateless mode: each `POST` carries a JSON-RPC 2.0 message and returns the response synchronously. Auth via `Authorization: Bearer <key>` (primary) or `?api_key=<key>` query param (fallback for clients that can't set headers, e.g. `EventSource`).

Paste into Claude Desktop / Cursor via the `mcp-remote` proxy:

```json
{
  "mcpServers": {
    "riskmodels": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://riskmodels.app/api/mcp/sse"],
      "env": { "AUTHORIZATION": "Bearer rm_agent_live_..." }
    }
  }
}
```

Tool calls bill per-invocation at the downstream REST endpoint (e.g. `riskmodels_get_stock_snapshot` costs the same as `GET /metrics/{ticker}`). Search tools and MCP resources are free.

Stdio remains available for local dev or air-gapped use (see below).

If you configure manually instead, add the server under Cursor Settings → MCP, or use a project file:

```json
{
  "mcpServers": {
    "riskmodels-api": {
      "command": "node",
      "args": ["/absolute/path/to/RiskModels_API/mcp/dist/index.js"]
    }
  }
}
```

You can also point **`command`** at your `riskmodels` CLI and **`args`** at `["mcp"]` if the CLI is on `PATH` and `mcp/dist/index.js` is discoverable (repo root or `RISKMODELS_MCP_SERVER_PATH`).

If **RiskModels_API** is the workspace root, a relative path is enough:

```json
"args": ["mcp/dist/index.js"]
```

Restart Cursor after editing the config.

**Optional:** Set `RISKMODELS_API_BASE=https://riskmodels.app` so the manifest resource fetches the live agent manifest from the API.

---

## Maintenance (for API / repo maintainers)

The MCP server serves static data from `mcp/data/`. When the live RiskModels API gains new endpoints, changes pricing, or updates response schemas, this data should be updated so Cursor and other MCP clients stay in sync.

### What gets updated

- **`data/capabilities.json`** — List of API capabilities (endpoints, methods, parameters, pricing, examples).
- **`data/schema-paths.json`** — List of response schema paths.
- **`data/schemas/*.json`** — JSON Schema files for each response type.
- **`data/openapi.json`** — Optional; can mirror or summarize the repo’s [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml).

### How to update

The **canonical API and capabilities** live in the [Risk_Models](https://github.com/BlueWaterCorp/Risk_Models) platform repo. From that repo you can run `npm run generate-mcp-data` (in `riskmodels_net/`) to regenerate `capabilities.json`, `schema-paths.json`, and `schemas/*.json` from the app’s `lib/agent` registry; then copy the updated files into this repo’s `mcp/data/`. The `openapi.json` here is a subset of the full [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml) and should be updated when new public endpoints are added.

1. **Obtain updated data** from the canonical source (Risk_Models) or by hand from the API application’s capabilities and schema registry.
2. **Replace** the contents of `mcp/data/`:
   - `capabilities.json`
   - `schema-paths.json`
   - `schemas/*.json`
   - `openapi.json` (if used)
3. **If server code changed** (e.g. new resources or tools): update `mcp/src/index.ts` (and any other source files), then run `npm run build` inside `mcp/`.
4. **Commit and push** so users who clone RiskModels_API get the latest MCP behavior and data.

### When to update

- New public API endpoints or capabilities.
- Changes to existing endpoints (parameters, pricing, descriptions).
- New or changed response schemas.
- OpenAPI spec changes you want reflected in the `riskmodels:///openapi` resource.

Keeping `data/` in sync with the live API after releases or significant API changes ensures the MCP server remains a reliable reference for developers and tools.
