# riskmodels-cli

Command-line interface for [RiskModels](https://riskmodels.net): call the REST API (metrics, batch, portfolio, returns, rankings, etc.), run billed SQL queries, explore schema in direct (Supabase) mode, check balance, and export agent tool manifests.

## Install

```bash
npm install -g riskmodels-cli
```

## Authentication

- **API key (recommended):** `riskmodels config init` (billed mode) or `riskmodels config set apiKey <rm_agent_...>`.
- **OAuth client credentials:** `riskmodels config set clientId …` and `config set clientSecret …`, or set `RISKMODELS_CLIENT_ID` / `RISKMODELS_CLIENT_SECRET` (optional `RISKMODELS_OAUTH_SCOPE`; default matches the Python SDK).
- **Environment:** `RISKMODELS_API_KEY` works without a config file for REST commands.
- **Direct (Supabase) mode** is for `query` + `schema` only. REST analytics need an API key or OAuth (config or env).

Base URL: stored as `apiBaseUrl` (default `https://riskmodels.app`). The CLI calls paths under `…/api/...` (same as `OPENAPI_SPEC.yaml`).

## Quick start (billed / recommended)

```bash
riskmodels config init
# Choose API Key mode and enter your rm_agent_* key

riskmodels health
riskmodels metrics NVDA
riskmodels query "SELECT ticker, company_name FROM ticker_metadata LIMIT 3"
riskmodels balance
```

Config file: `~/.config/riskmodels/config.json`

## Commands

| Command | Description |
|--------|-------------|
| `riskmodels config init \| set \| list` | API key, OAuth fields (`clientId`, `clientSecret`, `oauthScope`), `apiBaseUrl`, or Supabase (direct) |
| `riskmodels query "<sql>"` | SELECT only (billed → `POST /api/cli/query`, direct → Supabase `exec_sql`) |
| `riskmodels metrics <ticker>` | Latest snapshot (`GET /api/metrics/{ticker}`) |
| `riskmodels batch analyze` | `POST /api/batch/analyze` (`--tickers`, `--metrics`, `--years`) |
| `riskmodels portfolio risk-index` | `POST /api/portfolio/risk-index` (`--file` or `--stdin`) |
| `riskmodels returns ticker\|stock\|etf` | `GET /api/ticker-returns`, `/returns`, `/etf-returns` |
| `riskmodels l3 <ticker>` | `GET /api/l3-decomposition` |
| `riskmodels correlation post\|metrics` | `POST /api/correlation`, `GET /api/metrics/{ticker}/correlation` |
| `riskmodels rankings snapshot\|badge\|top` | Rankings endpoints |
| `riskmodels tickers` | Universe search (`GET /api/tickers`, no auth) |
| `riskmodels health` | `GET /api/health` (no auth) |
| `riskmodels estimate` | `POST /api/estimate` (pre-flight cost) |
| `riskmodels schema` | PostgREST OpenAPI (direct mode only) |
| `riskmodels balance` | Account balance (`GET /api/balance`) |
| `riskmodels manifest [--format openai\|anthropic\|zed]` | Static tool manifest (no auth) |
| `riskmodels agent decompose\|monitor` | Shortcuts → batch analyze / metrics |

Global flag: `--json` for machine-readable output on supported commands.

## Develop

```bash
cd cli
npm install
npm run build
npm run install:global   # npm link for local testing
```

The repo root `npm run typecheck` includes `cli/src` (see `AGENTS.md`). Maintainer drift check: `npm run cli:openapi-check` at the repo root.

## npm releases (maintainers)

Publishing (`npm publish`, version bumps, npm login / tokens) is **not** documented in this public README. It is maintained in the private **BWMACRO** monorepo at **`docs/RISKMODELS_CLI_NPM_PUBLISHING.md`** — open that file from your internal BWMACRO clone.

**Rule of thumb:** run publish commands only from **`cli/`**; the repo root package is the Next.js portal, not this CLI.
