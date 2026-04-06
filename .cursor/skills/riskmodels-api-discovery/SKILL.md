---
name: riskmodels-api-discovery
description: >-
  Discover RiskModels API endpoints, schemas, and billing before building clients.
  Use when adding or editing SDK methods, HTTP examples, CLI, MCP tools, or any
  code that calls riskmodels.app. Requires RiskModels MCP when available; falls
  back to OPENAPI_SPEC.yaml and mcp/data/openapi.json.
---

# RiskModels API discovery

## When to use this skill

Apply **before** implementing or refactoring:

- New Python/TypeScript/CLI calls to `https://riskmodels.app/api`
- SDK methods in `sdk/riskmodels/client.py`
- Example scripts under `examples/python/` or `packages/riskmodels/examples/`
- Anything that embeds paths, JSON bodies, or query params for the public API

## Discovery order (mandatory)

### 1. MCP tools (if connected)

Use the **RiskModels MCP server** tools exposed in Cursor (names may be prefixed depending on server config; canonical names from `mcp/README.md`):

| Step | Tool | Purpose |
|------|------|--------|
| 1 | **`riskmodels_list_endpoints`** | Latest index of capabilities: ids, HTTP method, path, short description, cost hints. **No arguments.** Run this first so you are not working from an outdated mental model. |
| 2 | **`riskmodels_get_capability`** | Full detail for one capability id (parameters, pricing, examples). Input: `{ "id": "<capability-id>" }`. |
| 3 | **`riskmodels_get_schema`** | JSON response schema for an endpoint path. Input: `{ "path": "/portfolio/risk-snapshot" }` (shape per tool schema). |

Treat the output of these tools as the **provisioning schema** for what the API exposes and how it bills—prefer them over remembered URLs when the server is available.

### 2. Repo sources (always)

Regardless of MCP:

- **`OPENAPI_SPEC.yaml`** — canonical REST contract at repo root.
- **`mcp/data/openapi.json`** — JSON mirror used by the MCP server; good for grep and CI.
- **`lib/api/schemas.ts`** — Zod validation for Next.js routes (must stay aligned with OpenAPI).
- **`SEMANTIC_ALIASES.md`** — field names for user-facing tables and the Python SDK.

### 3. CLI / ad-hoc data exploration

The `cli-query` capability (`POST /api/cli/query`) allows SELECT-only SQL queries against Supabase tables (`security_history`, `symbols`, `macro_factors`). Use it as a fallback when you need to explore raw data that isn't exposed through a dedicated endpoint — e.g., checking available date ranges, confirming column names, or sampling rows before building a client.

```python
resp = requests.post(
    "https://riskmodels.app/api/cli/query",
    headers={"Authorization": f"Bearer {api_key}"},
    json={"sql": "SELECT ticker, l3_mkt_er, l3_res_er FROM security_history WHERE ticker = 'AAPL' ORDER BY date DESC LIMIT 5"}
)
```

Cost: $0.003/request. Rate-limited to 60/min. SELECT only — no writes.

### 4. Human / portal

- **Auth and keys:** [AUTHENTICATION_GUIDE.md](../../AUTHENTICATION_GUIDE.md), [riskmodels.app/get-key](https://riskmodels.app/get-key). Agents cannot mint keys without user login; document env vars (`RISKMODELS_API_KEY`, `RISKMODELS_BASE_URL`).

## After discovery

- Implement against the **discovered** path and body (e.g. `title` not `name` on `POST /portfolio/risk-snapshot`).
- Update **OpenAPI + MCP data** when the server contract changes (see `.agents/skills/repo-sync/` and maintainer rules).
- Add or extend tests (`tests/*.test.ts`, `sdk/tests/`) for new client surfaces.

## Cursor: Nightly channel

To reduce stale-tool issues when MCP registers many tools or updates often, use Cursor **Settings → Beta → Update channel → Nightly**. This is a **local user setting**; document it for the team but do not assume it is on in every session.

## Related docs in this repo

- [mcp/README.md](../../mcp/README.md) — MCP tool list and design.
- [docs/portfolio-risk-snapshot-runbook.md](../../docs/portfolio-risk-snapshot-runbook.md) — example discovery → minimal PDF client.
- [SKILL.md](../../SKILL.md) (repo root) — research assistant + graphing; defers to this skill for contract discovery.
