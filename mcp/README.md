# RiskModels API MCP Server

MCP server that exposes **RiskModels API** inside [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com), [Zed](https://zed.dev), and any other [MCP](https://modelcontextprotocol.io) client. Two classes of tools:

- **Discovery tools** — list endpoints, read capabilities, fetch response schemas (no API key required).
- **Data tools** — fetch daily EOD risk decomposition, metrics snapshots, and portfolio risk reports (API key required).

Data tools return the same numbers the REST API and CLI return — GCP zarr for historical time series, Supabase `security_history_latest` for the latest snapshot. Data freshness: daily after US market close.

---

## Resources (read-only, no auth)

| URI | Description |
|-----|-------------|
| `riskmodels:///manifest` | Agent Protocol manifest. Fetches from `RISKMODELS_API_BASE` when set; otherwise returns static capabilities. |
| `riskmodels:///capabilities` | Full list of API capabilities (endpoints, parameters, pricing, examples). |
| `riskmodels:///schemas/list` | List of available response schema paths. |
| `riskmodels:///schemas/{path}` | JSON schema for a response (e.g. `ticker-returns-v2.json`). |
| `riskmodels:///openapi` | OpenAPI 3.x spec (`data/openapi.json`). |

## Discovery tools (no auth)

| Tool | Description |
|------|-------------|
| `riskmodels_list_endpoints` | List all public API capabilities (id, name, method, endpoint, short description). |
| `riskmodels_get_capability` | Get full capability by id (parameters, pricing, examples). |
| `riskmodels_get_schema` | Get JSON schema by path (e.g. `ticker-returns-v2.json`). |

## Data tools (API key required)

| Tool | Wraps | What it returns |
|------|-------|-----------------|
| `get_l3_decomposition` | `GET /api/l3-decomposition` | Daily EOD hierarchical decomposition (market → sector → subsector → residual) with parallel time-series arrays + L3 hedge ratios. |
| `get_metrics` | `GET /api/metrics/{ticker}` | Latest snapshot from the `_latest` table: L1/L2/L3 hedge ratios, ER fractions, volatility, close price, market cap. |
| `get_portfolio_risk_snapshot` | `POST /api/portfolio/risk-snapshot` | Portfolio variance decomposition (up to 100 positions), optional diversification analytics, Redis-cached per user/portfolio for 1h. |

Every data-tool response includes a meter envelope so agents can self-throttle:

```json
{
  ...actual data...,
  "_cost_usd": 0.003,
  "_remaining_daily_usd": 4.997,
  "_rate_limit_remaining": 59,
  "_data_as_of": "2026-04-15",
  "_data_source": "zarr"
}
```

### Credentials

The server resolves the API key in this order:

1. `RISKMODELS_API_KEY` from the MCP client's env config (explicit override).
2. `apiKey` field in `~/.config/riskmodels/config.json` (shared with the `riskmodels` CLI).

Run `riskmodels config init` once — the CLI's stored key is automatically picked up by the MCP server. No need to duplicate the key in your `claude_desktop_config.json`.

Base URL resolution: `RISKMODELS_API_BASE` env → `apiBaseUrl` in CLI config → `https://riskmodels.app` default.

---

## Python SDK on PyPI

This MCP server exposes **discovery** (capabilities, schemas, OpenAPI). For live **`/metrics`**, **`/batch/analyze`**, **`/l3-decomposition`**, and other data routes, call the REST API or install **`riskmodels-py`** from [PyPI](https://pypi.org/project/riskmodels-py/) ([`sdk/README.md`](../sdk/README.md)).

---

## Setup

```bash
cd mcp
npm install
npm run build
```

This repo includes **`.cursor/mcp.json`** pointing at `node` + `mcp/dist/index.js` (relative to the **RiskModels_API** workspace root). After `cd mcp && npm ci && npm run build`, open **RiskModels_API** as a folder in Cursor (or add it in a multi-root workspace), then **restart Cursor** or reload MCP so **`riskmodels_list_endpoints`** appears.

### Claude Desktop / `npx` (common mistakes)

- **There is no `mcp` subcommand on the npm package.** The CLI binary is **`riskmodels`** (package name `riskmodels-cli`). Do **not** run `npx -y riskmodels-cli mcp` — that fails with `unknown command 'mcp'`.
- **Use one of these:**
  - **`riskmodels mcp-config`** — prints a ready-to-paste `mcpServers` block for Claude Desktop (`--client claude-desktop`) or Cursor. Use **`riskmodels mcp-config --embed-key`** only if you want the key in the JSON env block.
  - **`riskmodels mcp`** — runs the stdio MCP server (same as `node mcp/dist/index.js`). Requires `mcp/dist/index.js` to exist (build `mcp/` first), or set **`RISKMODELS_MCP_SERVER_PATH`** to that file.
  - **`node /absolute/path/to/RiskModels_API/mcp/dist/index.js`** — always works if the build exists.

### Hosted endpoint (`https://riskmodels.app/api/mcp/sse`)

The hosted endpoint implements the **MCP Streamable HTTP** transport (current SDK spec, successor to legacy SSE+companion-POST). Stateless mode: each `POST` carries a JSON-RPC 2.0 message and returns the response synchronously. Auth via `Authorization: Bearer <key>` (primary) or `?api_key=<key>` query param (fallback for clients that can't set headers, e.g. `EventSource`).

Paste into Claude Desktop / Cursor via the `mcp-remote` proxy:

```json
{
  "mcpServers": {
    "riskmodels": {
      "command": "npx",
      "args": ["mcp-remote", "https://riskmodels.app/api/mcp/sse"],
      "env": { "AUTHORIZATION": "Bearer rm_agent_live_..." }
    }
  }
}
```

Tool calls bill per-invocation at the downstream REST endpoint (e.g. `get_metrics` costs the same as `GET /metrics/{ticker}`). Discovery tools (`riskmodels_list_endpoints`, etc.) are free.

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

The **canonical API and capabilities** live in the [Risk_Models](https://github.com/BlueWaterCorp/Risk_Models) platform repo. From that repo you can run `npm run generate-mcp-data` (in `riskmodels_com/`) to regenerate `capabilities.json`, `schema-paths.json`, and `schemas/*.json` from the app’s `lib/agent` registry; then copy the updated files into this repo’s `mcp/data/`. The `openapi.json` here is a subset of the full [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml) and should be updated when new public endpoints are added.

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
