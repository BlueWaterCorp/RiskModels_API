# MCP directory: every-tool execution record

Server: `https://riskmodels.app/api/mcp/sse` (Streamable HTTP). Client: official MCP Inspector CLI, `@modelcontextprotocol/inspector@2.8.0 --cli --transport http`, API-key bearer auth.
Run: 2026-10-10T21:06:34+00:00 to 2026-10-10T21:09:12+00:00 (UTC), against production after PR #426 (GET-only generic reader, factual descriptions, `isError` on failures). `tools/list` returned 37 tools; each was called once with the valid inputs below.

A call passes when the CLI exits 0, the result has no `isError`, and the response text carries no `error` key. Response bodies are kept in a private log, because one tool returns the operator's linked brokerage book; here they are summarised by size only.

**Result: 37 of 37 tools succeeded. No response contained a presentation command (`chart_instruction`).**

| # | Tool | Arguments | Status | Latency (ms) | Response chars |
|---|---|---|---|---|---|
| 1 | `riskmodels_decompose` | `{"ticker": "NVDA"}` | ok | 7553 | 7,079 |
| 2 | `riskmodels_get_returns` | `{"ticker": "AAPL", "years": 1}` | ok | 7086 | 212,547 |
| 3 | `riskmodels_get_return_attribution` | `{"ticker": "MSFT", "years": 1}` | ok | 5633 | 73,069 |
| 4 | `riskmodels_get_lstar` | `{"ticker": "JPM", "years": 1}` | ok | 5300 | 48,705 |
| 5 | `riskmodels_batch_lstar` | `{"tickers": ["AAPL", "XOM"], "years": 1}` | ok | 5629 | 110,255 |
| 6 | `riskmodels_get_hedge_levels` | `{"ticker": "AMZN"}` | ok | 6011 | 5,873 |
| 7 | `riskmodels_compare` | `{"tickers": ["AAPL", "NVDA"]}` | ok | 5357 | 12,618 |
| 8 | `riskmodels_hedge_position` | `{"ticker": "NVDA", "dollars": 10000}` | ok | 4382 | 6,930 |
| 9 | `riskmodels_get_my_positions` | `{}` | ok | 3611 | 7,173 |
| 10 | `riskmodels_analyze_portfolio` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 4656 | 15,325 |
| 11 | `riskmodels_hedge_portfolio` | `{"positions": [{"ticker": "AAPL", "dollars": 50000}, {"ticker": "XOM", "dollars": 30000}]}` | ok | 4161 | 13,369 |
| 12 | `riskmodels_portfolio_exposure` | `{"positions": [{"ticker": "NVDA", "value": 1000000}, {"ticker": "AMD", "value": -600000}, {"ticker": "XLK",…` | ok | 5648 | 6,954 |
| 13 | `riskmodels_portfolio_decompose` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 1885 | 13,406 |
| 14 | `riskmodels_whitepaper_example` | `{"exampleId": "aapl-vs-nvda"}` | ok | 4544 | 13,017 |
| 15 | `riskmodels_search_tickers` | `{"search": "micro"}` | ok | 1855 | 1,381 |
| 16 | `riskmodels_search_filers` | `{"q": "Berkshire", "limit": 3}` | ok | 1922 | 2,437 |
| 17 | `riskmodels_search_etfs` | `{"q": "semiconductor", "limit": 3}` | ok | 1369 | 851 |
| 18 | `riskmodels_get_rankings` | `{"ticker": "NVDA", "metric": "subsector_residual", "cohort": "sector", "window": "252d"}` | ok | 5946 | 1,528 |
| 19 | `riskmodels_get_cohorts` | `{"cohorts": "SPY,XLK"}` | ok | 5128 | 3,919 |
| 20 | `riskmodels_decompose_selection_vs_drift` | `{"positions": [{"ticker": "AAPL", "weight": 0.5}, {"ticker": "XOM", "weight": 0.5}], "level": "sector", "st…` | ok | 6465 | 3,350 |
| 21 | `riskmodels_get_fundamentals` | `{"ticker": "AAPL", "periods": 4}` | ok | 4447 | 25,766 |
| 22 | `riskmodels_screen_rankings` | `{"metric": "subsector_residual", "cohort": "universe", "window": "252d", "limit": 5}` | ok | 4451 | 2,230 |
| 23 | `riskmodels_get_macro_correlation` | `{"ticker": "XOM"}` | ok | 5738 | 1,840 |
| 24 | `riskmodels_get_residual_signal` | `{"tickers": ["AAPL", "MSFT", "NVDA"]}` | ok | 6435 | 3,612 |
| 25 | `riskmodels_get_filer_snapshot` | `{"bw_filer_id": "BW-FILER-CIK0001067983"}` | ok | 4870 | 25,253 |
| 26 | `riskmodels_get_filer_holdings` | `{"bw_filer_id": "BW-FILER-CIK0001067983", "top": 5}` | ok | 4636 | 9,837 |
| 27 | `riskmodels_get_etf` | `{"ticker": "XLK"}` | ok | 1406 | 571 |
| 28 | `riskmodels_get_etf_holdings` | `{"ticker": "XLK", "top": 5}` | ok | 1374 | 1,247 |
| 29 | `riskmodels_get_benchmark_fit` | `{"subject": "XLK", "benchmark": "ff_own", "top": 5}` | ok | 3967 | 3,061 |
| 30 | `riskmodels_call_endpoint` | `{"path": "/metrics/AAPL"}` | ok | 4232 | 3,756 |
| 31 | `riskmodels_render_artifact` | `{"slug": "l3_explained_risk_hbar", "subject_id": "BW-STOCK-NVDA", "format": "json"}` | ok | 4539 | 794 |
| 32 | `riskmodels_list_endpoints` | `{}` | ok | 1262 | 16,155 |
| 33 | `riskmodels_get_capability` | `{"id": "ticker-returns"}` | ok | 1210 | 1,821 |
| 34 | `riskmodels_get_schema` | `{"path": "/schemas/ticker-returns-v2.json"}` | ok | 1207 | 2,781 |
| 35 | `get_l3_decomposition` | `{"ticker": "AAPL", "years": 1}` | ok | 4580 | 50,244 |
| 36 | `get_metrics` | `{"ticker": "MSFT"}` | ok | 4044 | 3,624 |
| 37 | `get_portfolio_risk_snapshot` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 1627 | 9,264 |

## Failure handling

Each call below is meant to fail. It passes when the result is flagged `isError: true`.

| Tool | Arguments | isError | Error text (start) |
|---|---|---|---|
| `riskmodels_call_endpoint` | `{"path": "/portfolio/exposure/history"}` | true | { "error": "GET /portfolio/exposure/history is not a catalog endpoint this tool can read. Only GET endpoints a |
| `riskmodels_get_schema` | `{"path": "/schemas/does-not-exist.json"}` | true | {"error":"Schema not found: does-not-exist.json","available":["/schemas/ticker-returns-v2.json","/schemas/macr |
| `riskmodels_get_capability` | `{"id": "no-such-capability"}` | true | {"error":"Unknown capability: no-such-capability","available":["ticker-returns","metrics","rankings","risk-dec |
| `riskmodels_call_endpoint` | `{"path": "/data/benchmark-fit", "query": {"subject": "XLK", "benchmark": "SPY"}}` | true | RiskModels API HTTP 409: benchmark 'BW-BENCH-SPY' is under development |

## Directory compliance (PR #426)

- `riskmodels_call_endpoint` is GET-only. Its inputs are `path` and `query`, and its allowlist holds GET catalog entries only. Its description links https://riskmodels.app/docs/api.
- Tool descriptions state inputs, outputs, scope and price. They carry no presentation commands and no instructions to call other tools; `tests/mcp-directory-compliance.test.ts` enforces this.
- `riskmodels_get_benchmark_fit` accepts only live benchmarks (`ff_own`, the large and small style cells, `all`).

## Data handling

What an MCP tool call leaves behind on RiskModels systems:

- **MCP route** (`/api/mcp/sse`): does not log request bodies or tool arguments. Auth and transport errors log only the first 15 characters of the API key.
- **Billing ledger** (`billing_events`, billed calls only): user id, request id, capability id, cost, balance, and metadata of the request URL, user agent and IP. For GET tools the URL includes the tool's query inputs (for example a ticker). POST bodies, such as portfolio positions, are not stored.
- **Telemetry rows**: status code, latency, success and any error message. For institutional-licence keys they also hold the ticker symbols in the request (never position sizes) for metering.
- **Application logs**: some REST routes log the ticker on errors or lookups (for example `[Metrics API] Fetching AAPL`).
- **Caching**: portfolio risk snapshots are cached for one hour per user and portfolio, so the result is reusable within that hour.
- **Analytics**: PostHog runs in the browser only and is not loaded by any API or MCP route.
- **Not covered by this audit**: the linked-brokerage book is read from riskmodels.net, a separate application; Vercel's own platform request logs record request URLs under Vercel's retention.
