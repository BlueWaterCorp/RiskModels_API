# MCP directory: every-tool execution record

Server: `https://riskmodels.app/api/mcp/sse` (Streamable HTTP). Client: official MCP Inspector CLI, `@modelcontextprotocol/inspector@2.8.0 --cli --transport http`, API-key bearer auth.
Run: 2026-10-10T20:43:14+00:00 to 2026-10-10T20:45:33+00:00 (UTC). `tools/list` returned 37 tools; each was called once with the valid inputs below.

A call counts as successful when the CLI exits 0, the result has no `isError`, and the response text carries no `error` key. Response bodies are kept in a private log (one tool returns the operator's linked brokerage book) and are summarised here by size only.

**Result: 37 of 37 tools succeeded.**

| # | Tool | Arguments | Status | Latency (ms) | Response chars |
|---|---|---|---|---|---|
| 1 | `riskmodels_decompose` | `{"ticker": "NVDA"}` | ok | 4544 | 7,277 |
| 2 | `riskmodels_get_returns` | `{"ticker": "AAPL", "years": 1}` | ok | 3882 | 212,745 |
| 3 | `riskmodels_get_return_attribution` | `{"ticker": "MSFT", "years": 1}` | ok | 3996 | 73,267 |
| 4 | `riskmodels_get_lstar` | `{"ticker": "JPM", "years": 1}` | ok | 3835 | 48,903 |
| 5 | `riskmodels_batch_lstar` | `{"tickers": ["AAPL", "XOM"], "years": 1}` | ok | 4020 | 110,453 |
| 6 | `riskmodels_get_hedge_levels` | `{"ticker": "AMZN"}` | ok | 3821 | 6,071 |
| 7 | `riskmodels_compare` | `{"tickers": ["AAPL", "NVDA"]}` | ok | 3975 | 12,816 |
| 8 | `riskmodels_hedge_position` | `{"ticker": "NVDA", "dollars": 10000}` | ok | 4221 | 7,128 |
| 9 | `riskmodels_get_my_positions` | `{}` | ok | 2850 | 7,558 |
| 10 | `riskmodels_analyze_portfolio` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 5867 | 15,523 |
| 11 | `riskmodels_hedge_portfolio` | `{"positions": [{"ticker": "AAPL", "dollars": 50000}, {"ticker": "XOM", "dollars": 30000}]}` | ok | 6423 | 13,567 |
| 12 | `riskmodels_portfolio_exposure` | `{"positions": [{"ticker": "NVDA", "value": 1000000}, {"ticker": "AMD", "value": -600000}, {"ticker": "XLK",…` | ok | 5050 | 7,152 |
| 13 | `riskmodels_portfolio_decompose` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 1713 | 13,604 |
| 14 | `riskmodels_whitepaper_example` | `{"exampleId": "aapl-vs-nvda"}` | ok | 5180 | 13,215 |
| 15 | `riskmodels_search_tickers` | `{"search": "micro"}` | ok | 1872 | 1,579 |
| 16 | `riskmodels_search_filers` | `{"q": "Berkshire", "limit": 3}` | ok | 1467 | 2,635 |
| 17 | `riskmodels_search_etfs` | `{"q": "semiconductor", "limit": 3}` | ok | 1448 | 1,049 |
| 18 | `riskmodels_get_rankings` | `{"ticker": "NVDA", "metric": "subsector_residual", "cohort": "sector", "window": "252d"}` | ok | 4748 | 1,726 |
| 19 | `riskmodels_get_cohorts` | `{"cohorts": "SPY,XLK"}` | ok | 4505 | 4,117 |
| 20 | `riskmodels_decompose_selection_vs_drift` | `{"positions": [{"ticker": "AAPL", "weight": 0.5}, {"ticker": "XOM", "weight": 0.5}], "level": "sector", "st…` | ok | 4554 | 3,548 |
| 21 | `riskmodels_get_fundamentals` | `{"ticker": "AAPL", "periods": 4}` | ok | 4535 | 25,964 |
| 22 | `riskmodels_screen_rankings` | `{"metric": "subsector_residual", "cohort": "universe", "window": "252d", "limit": 5}` | ok | 4029 | 2,428 |
| 23 | `riskmodels_get_macro_correlation` | `{"ticker": "XOM"}` | ok | 4161 | 2,038 |
| 24 | `riskmodels_get_residual_signal` | `{"tickers": ["AAPL", "MSFT", "NVDA"]}` | ok | 4350 | 3,810 |
| 25 | `riskmodels_get_filer_snapshot` | `{"bw_filer_id": "BW-FILER-CIK0001067983"}` | ok | 4693 | 25,451 |
| 26 | `riskmodels_get_filer_holdings` | `{"bw_filer_id": "BW-FILER-CIK0001067983", "top": 5}` | ok | 4261 | 10,035 |
| 27 | `riskmodels_get_etf` | `{"ticker": "XLK"}` | ok | 1373 | 769 |
| 28 | `riskmodels_get_etf_holdings` | `{"ticker": "XLK", "top": 5}` | ok | 1422 | 1,445 |
| 29 | `riskmodels_get_benchmark_fit` | `{"subject": "XLK", "benchmark": "ff_own", "top": 5}` | ok | 4392 | 3,259 |
| 30 | `riskmodels_call_endpoint` | `{"method": "GET", "path": "/metrics/AAPL"}` | ok | 5426 | 3,954 |
| 31 | `riskmodels_render_artifact` | `{"slug": "l3_explained_risk_hbar", "subject_id": "BW-STOCK-NVDA", "format": "json"}` | ok | 7893 | 992 |
| 32 | `riskmodels_list_endpoints` | `{}` | ok | 1518 | 16,155 |
| 33 | `riskmodels_get_capability` | `{"id": "ticker-returns"}` | ok | 1590 | 1,821 |
| 34 | `riskmodels_get_schema` | `{"path": "/schemas/ticker-returns-v2.json"}` | ok | 1319 | 2,781 |
| 35 | `get_l3_decomposition` | `{"ticker": "AAPL", "years": 1}` | ok | 5221 | 50,244 |
| 36 | `get_metrics` | `{"ticker": "MSFT"}` | ok | 4630 | 3,625 |
| 37 | `get_portfolio_risk_snapshot` | `{"positions": [{"ticker": "AAPL", "weight": 0.4}, {"ticker": "MSFT", "weight": 0.35}, {"ticker": "JPM", "we…` | ok | 1611 | 9,264 |

## Issues found while testing

- **Tool errors are returned as successes.** `riskmodels_get_schema` with an unknown path and `riskmodels_get_benchmark_fit` against an unavailable benchmark returned an `error` object in the text with `isError` unset. Clients and reviewers will read those as successes.
- **`riskmodels_get_benchmark_fit` documents SPY and 70/30 as free static benchmarks, but both return 409 "under development".** `ff_own` and `all` work. The run above uses `ff_own`.

Reproduce: `scripts` are in the private review folder (`BWMACRO/work/reviews/mcp_directory_20261010/`); the harness reads `RISKMODELS_API_KEY` from the environment.
