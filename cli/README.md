# riskmodels-cli

Command-line interface for [RiskModels](https://riskmodels.net): run billed SQL queries against the API, explore schema in direct (Supabase) mode, check balance, and export agent tool manifests.

## Install

```bash
npm install -g riskmodels-cli
```

## Quick start (billed / recommended)

```bash
riskmodels config init
# Choose API Key mode and enter your rm_agent_* key

riskmodels query "SELECT ticker, company_name FROM ticker_metadata LIMIT 3"
riskmodels balance
```

Config file: `~/.config/riskmodels/config.json`

## Commands

| Command | Description |
|--------|-------------|
| `riskmodels config init \| set \| list` | Configure API key (billed) or Supabase (direct dev) |
| `riskmodels query "<sql>"` | Run a SELECT (billed → `/api/cli/query`, direct → Supabase `exec_sql`) |
| `riskmodels schema` | List tables / OpenAPI (direct mode only) |
| `riskmodels balance` | Account balance (billed mode) |
| `riskmodels manifest [--format openai\|anthropic\|zed]` | Print static tool manifest (no auth) |
| `riskmodels agent` | Placeholder; use REST, MCP, or the Python SDK for portfolio flows |

Global flag: `--json` for machine-readable output.

## Agent subcommands

`riskmodels agent decompose` and related flows are **not implemented** in this CLI version. Use:

- HTTP API: `POST /api/batch/analyze`, `GET /api/metrics/{ticker}`, etc. ([docs](https://riskmodels.net/docs/api))
- MCP server in this repo: `mcp/`
- Python SDK: `riskmodels` on PyPI

## Develop

```bash
cd cli
npm install
npm run build
npm run install:global   # npm link for local testing
```

## Publish

```bash
cd cli
npm publish
```

Use the `cli/` directory only; the repo root package is the web portal, not this CLI.
